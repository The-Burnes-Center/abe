import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { BedrockAgentRuntimeClient, RetrieveCommand as KBRetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { loadRenderedPrompt } from "./prompt-registry.mjs";

const PROMPT = `
You are a knowledgeable AI assistant. Answer the question accurately using ONLY information retrieved from the knowledge base.

## Core Rules
1. Base every answer strictly on the retrieved context. If the context does not contain the answer, say so honestly rather than guessing.
2. NEVER fabricate information, URLs, document names, identifiers, or figures that are not present in the retrieved context.
3. Cite the source document name when referencing specific information.
4. Use the query_db tool to retrieve relevant information before answering.
5. Be clear, concise, and well-structured; use markdown where it improves readability.
6. When a URL appears in the source documents, present it as a markdown link such as [text](URL); never output raw or fabricated URLs.
7. Maintain a neutral, unbiased tone and do not imply a ranking unless the data supports one.
8. For time-sensitive information, verify against the current date provided to you.
`;

// Claude model implementation
class ClaudeModel {
  constructor() {
    this.client = new BedrockRuntimeClient({
      region: "us-east-1",
    });
    this.modelId = process.env.PRIMARY_MODEL_ID || "us.anthropic.claude-sonnet-4-20250514-v1:0";
  }

  assembleHistory(hist, prompt) {
    var history = []
    hist.forEach((element) => {
      history.push({"role": "user", "content": [{"type": "text", "text": element.user}]});
      history.push({"role": "assistant", "content": [{"type": "text", "text": element.chatbot}]});
    });
    history.push({"role": "user", "content": [{"type": "text", "text": prompt}]});
    return history;
  }
  
  parseChunk(chunk) {
    if (chunk.type == 'content_block_delta') {
      if (chunk.delta.type == 'text_delta') {
        return chunk.delta.text
      }
      if (chunk.delta.type == "input_json_delta") {
        return chunk.delta.partial_json
      }
    } else if (chunk.type == "content_block_start") {
      if (chunk.content_block.type == "tool_use"){
        return chunk.content_block
      }
    } else if (chunk.type == "message_delta") {
      if (chunk.delta.stop_reason == "tool_use") {
        return chunk.delta
      } 
      else {
        return chunk.delta
      }
    }
    // Explicitly return null for unhandled chunk types to prevent undefined corruption
    return null;
  }

  async getStreamedResponse(system, history) {
    const payload = {
      "anthropic_version": "bedrock-2023-05-31",
      "system": [{ "type": "text", "text": system, "cache_control": { "type": "ephemeral" } }],
      "max_tokens": 2048,
      "messages": history,
      "temperature": 0.01,
      "tools": [
        {
          "name": "query_db",
          "description": "Query a vector database for any information in your knowledge base. Try to use specific key words when possible.",
          "input_schema": {
            "type": "object",
            "properties": {
              "query": {
                "type": "string",
                "description": "The query you want to make to the vector database."
              }
            },
            "required": [
              "query"
            ]
          }
        }
      ],
    };

    try {
      const command = new InvokeModelWithResponseStreamCommand({ body: JSON.stringify(payload), contentType: 'application/json', modelId: this.modelId });
      const apiResponse = await this.client.send(command);
      return apiResponse.body
    } catch (e) {
      console.error("Caught error: model invoke error")
    }
  }
}

// Import necessary AWS Bedrock clients
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Set up logging
const logger = {
  info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ERROR] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[WARN] ${message}`, ...args)
};

/* Use the Bedrock Knowledge Base*/
async function retrieveKBDocs(query, knowledgeBase, knowledgeBaseID, options = {}) {
  const input = { // RetrieveRequest
  knowledgeBaseId: knowledgeBaseID, // required
  retrievalQuery: { // KnowledgeBaseQuery
    text: query, // required
  }}
 

  try { 
    const command = new KBRetrieveCommand(input);
    const response = await knowledgeBase.send(command);

    // filter the items based on confidence, we do not want LOW confidence results.
    // Also drop the system-generated metadata.txt inventory file (it is ingested
    // into the KB alongside real documents and would pollute eval context).
    const confidenceFilteredResults = response.retrievalResults.filter(item => {
      if (!(item.score > 0.5)) return false;
      const uri = item.location?.s3Location?.uri || "";
      return (uri.split("/").pop() || "").toLowerCase() !== "metadata.txt";
    })
    
    logger.info(`Retrieved ${confidenceFilteredResults.length} results from knowledge base`);

    const documentUris = confidenceFilteredResults.map(item => {
      return { title: item.location.s3Location.uri.slice((item.location.s3Location.uri).lastIndexOf("/") + 1) + " (Bedrock Knowledge Base)", uri: item.location.s3Location.uri }
    });

    // removes duplicate sources based on URI
    const flags = new Set();
    const uniqueUris = documentUris.filter(entry => {
      if (flags.has(entry.uri)) {
        return false;
      }
      flags.add(entry.uri);
      return true;
    });

    let fullContent;
    if (options.formatForDisplay && confidenceFilteredResults.length > 0) {
      const n = confidenceFilteredResults.length;
      fullContent = confidenceFilteredResults.map((item, idx) => {
        const uri = item.location.s3Location.uri;
        const filename = uri.slice(uri.lastIndexOf("/") + 1);
        const score = typeof item.score === "number" ? item.score.toFixed(2) : "—";
        const header = `--- Chunk ${idx + 1} of ${n} | Source: ${filename} | Relevance: ${score} ---`;
        return `${header}\n\n${item.content.text}`;
      }).join("\n\n");
    } else {
      fullContent = confidenceFilteredResults.map(item => item.content.text).join('\n');
    }

    //Returning both full content and list of document URIs
    if (fullContent == '') {
      fullContent = `No knowledge available! This query is likely outside the scope of your knowledge.
      Please provide a general answer but do not attempt to provide specific details.`
      logger.warn("No relevant sources found for query");
    }

    return {
      content: fullContent,
      uris: uniqueUris
    };
  } catch (error) {
    logger.error("Could not retrieve Knowledge Base documents:", error);
    // return no context
    return {
      content: `No knowledge available! There is something wrong with the search tool. Please tell the user to submit feedback.
      Please provide a general answer but do not attempt to provide specific details.`,
      uris: []
    };
  }
}

// Function to fetch metadata
const fetchMetadata = async () => {
  const lambdaClient = new LambdaClient();
  const payload = JSON.stringify({});
  try {
    // If METADATA_RETRIEVAL_FUNCTION is not set, return null
    if (!process.env.METADATA_RETRIEVAL_FUNCTION) {
      logger.warn("METADATA_RETRIEVAL_FUNCTION environment variable not set");
      return null;
    }
    
    const command = new InvokeCommand({
      FunctionName: process.env.METADATA_RETRIEVAL_FUNCTION,
      Payload: Buffer.from(payload),
    });
    const response = await lambdaClient.send(command);

    // Parse the response payload
    const parsedPayload = JSON.parse(Buffer.from(response.Payload).toString());
    logger.info("Metadata retrieval response received");
    
    // Extract metadata from the body field
    const metadata = JSON.parse(parsedPayload.body).metadata;
    logger.info("Metadata extracted successfully");

    return metadata;
  } catch (error) {
    logger.error("Error fetching metadata:", error);
    return null;
  }
};

// Function to create dynamic prompt with metadata information
const constructSysPrompt = async() => {
    const metadata = await fetchMetadata();
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    const rendered = await loadRenderedPrompt(PROMPT, metadata, dateStr);
    if (metadata) {
      logger.info("Metadata added successfully to prompt");
    } else {
      logger.warn("Metadata information couldn't be added to prompt");
    }
    return rendered.promptText;
};

export async function* generateResponse(userMessage, chatHistory){
    // Validate required environment variables
    if (!process.env.KB_ID) {
      logger.error("KB_ID environment variable is not set");
      throw new Error("Knowledge Base ID is not found.");
    }

    const knowledgeBase = new BedrockAgentRuntimeClient();

    let claude = new ClaudeModel();
    let lastFiveMessages = chatHistory.slice(-2);

    let stopLoop = false;
    let modelResponse = '';

    let history = claude.assembleHistory(
      lastFiveMessages,
      userMessage
    );

    let fullDocs = { "content": "", "uris": [] };

    // Use the system prompt construction
    const SYS_PROMPT = await constructSysPrompt();
    
    logger.info("Starting chat interaction with user message:", userMessage.substring(0, 100) + (userMessage.length > 100 ? '...' : ''));

    while (!stopLoop) {
        logger.info("Getting streamed response from Claude model");
        const stream = await claude.getStreamedResponse(SYS_PROMPT, history);
        try {
          let toolInput = "";
          let assemblingInput = false;
          let usingTool = false;
          let toolId;
          let skipChunk = true;
          let message = {};
          let toolUse = {};
          // Track text generated in this iteration before tool use
          let currentIterationText = "";
    
          for await (const event of stream) {
            const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
            const parsedChunk = await claude.parseChunk(chunk);
            if (parsedChunk) {
              if (parsedChunk.stop_reason) {
                if (parsedChunk.stop_reason == "tool_use") {
                  assemblingInput = false;
                  usingTool = true;
                  skipChunk = true;
                  logger.info("Model is using a tool");
                } else {
                  logger.info(`Model stopped generation with reason: ${parsedChunk.stop_reason}`);
                  stopLoop = true;
                  break;
                }
              }
    
              if (parsedChunk.type && parsedChunk.type == "tool_use") {
                assemblingInput = true;
                toolId = parsedChunk.id;
                message['role'] = 'assistant';
                message['content'] = [];
                // Include any text generated before tool use so model won't repeat itself
                if (currentIterationText.length > 0) {
                  message['content'].push({ type: 'text', text: currentIterationText });
                }
                toolUse['name'] = parsedChunk.name;
                toolUse['type'] = 'tool_use';
                toolUse['id'] = toolId;
                toolUse['input'] = { 'query': "" };
                logger.info(`Tool use started: ${parsedChunk.name}`);
              }
    
              if (usingTool) {
                let query;
                try {
                  query = JSON.parse(toolInput);
                } catch (parseError) {
                  logger.error(`Failed to parse tool input JSON: ${toolInput}`);
                  // Add a synthetic tool result so Claude doesn't get stuck
                  message.content.push(toolUse);
                  history.push(message);
                  history.push({
                    "role": "user",
                    "content": [{
                      "type": "tool_result",
                      "tool_use_id": toolId,
                      "content": "Error: could not process the tool input. Please respond to the user without using tools."
                    }]
                  });
                  usingTool = false;
                  toolInput = "";
                  message = {};
                  toolUse = {};
                  continue;
                }

                logger.info(`Retrieving KB documents for query: ${query.query.substring(0, 100) + (query.query.length > 100 ? '...' : '')}`);
    
                let docString = await retrieveKBDocs(query.query, knowledgeBase, process.env.KB_ID);
                fullDocs.content = fullDocs.content.concat(docString.content);
                fullDocs.uris = fullDocs.uris.concat(docString.uris);
    
                toolUse.input.query = query.query;
                message.content.push(toolUse);
                history.push(message);
    
                let toolResponse = {
                  "role": "user",
                  "content": [
                    {
                      "type": "tool_result",
                      "tool_use_id": toolId,
                      "content": docString.content
                    }
                  ]
                };
    
                history.push(toolResponse);
                logger.info("Added tool response to history");
    
                usingTool = false;
                toolInput = "";
                message = {};
                toolUse = {};
    
              } else {
                if (assemblingInput && !skipChunk) {
                  // Guard against null/undefined from parseChunk
                  if (parsedChunk !== null && parsedChunk !== undefined) {
                    toolInput = toolInput.concat(parsedChunk);
                  }
                } else if (!assemblingInput) {
                  modelResponse = modelResponse.concat(parsedChunk);
                  currentIterationText = currentIterationText.concat(parsedChunk);
                  yield parsedChunk; // Yield each chunk as it's generated
                } else if (skipChunk) {
                  skipChunk = false;
                }
              }
            }
          }
    
        } catch (error) {
          logger.error("Stream processing error:", error);
          throw error; // Propagate the error to the caller
        }
    }
    
    logger.info("Response generation complete, total length:", modelResponse.length);
    yield {
        "type": "final",
        "modelResponse": modelResponse,
        "sources": fullDocs
    }
}

// Lambda handler function
export const handler = async (event) => {
  try {
    const userMessage = event.userMessage;
    const chatHistory = event.chatHistory || [];
    const getContextOnly = event.get_context_only || false;
    
    logger.info("Received request to generate response");

    // If getContextOnly is true, only retrieve context without generating a response
    if (getContextOnly) {
      logger.info("Context-only request received");
      
      if (!process.env.KB_ID) {
        logger.error("KB_ID environment variable is not set");
        throw new Error("Knowledge Base ID is not found.");
      }

      const knowledgeBase = new BedrockAgentRuntimeClient();
      
      // Only retrieve knowledge base documents without generating a response (formatted for eval UI)
      try {
        const docResults = await retrieveKBDocs(userMessage, knowledgeBase, process.env.KB_ID, { formatForDisplay: true });
        logger.info(`Retrieved ${docResults.uris.length} documents from knowledge base`);
        
        return {
          statusCode: 200,
          body: JSON.stringify({
            context: docResults.content,
            sources: docResults.uris,
          }),
        };
      } catch (error) {
        logger.error("Error retrieving context:", error);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: error.message,
            context: "",
          }),
        };
      }
    }

    // Normal response generation
    const responseGenerator = generateResponse(userMessage, chatHistory);

    let modelResponse;
    let sources;

    for await (const chunk of responseGenerator) {
        if (chunk.type == "final") {
            modelResponse = chunk.modelResponse;
            sources = chunk.sources;
            break;
        }
    }
    
    logger.info("Successfully generated response");
    logger.info(`Generated response for message "${userMessage}":\n${modelResponse}`);
    logger.info(`Sources used: ${JSON.stringify(sources.uris)}`);

    // Return the modelResponse and sources
    return {
      statusCode: 200,
      body: JSON.stringify({
        modelResponse,
        sources,
      }),
    };
  } catch (error) {
    logger.error("Error in generateResponseLambda:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message,
      }),
    };
  }
};
