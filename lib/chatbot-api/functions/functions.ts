import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

// Import Lambda L2 construct
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import { S3EventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

interface LambdaFunctionStackProps {  
  readonly wsApiEndpoint : string;  
  readonly sessionTable : Table;  
  readonly feedbackTable : Table;
  readonly feedbackBucket : s3.Bucket;
  readonly knowledgeBucket : s3.Bucket;
  readonly knowledgeBase : bedrock.CfnKnowledgeBase;
  readonly knowledgeBaseSource: bedrock.CfnDataSource;
}



export class LambdaFunctionStack extends cdk.Stack {  
  public readonly chatFunction : lambda.Function;
  public readonly sessionFunction : lambda.Function;
  public readonly feedbackFunction : lambda.Function;
  public readonly deleteS3Function : lambda.Function;
  public readonly getS3Function : lambda.Function;
  public readonly uploadS3Function : lambda.Function;
  public readonly syncKBFunction : lambda.Function;
  public readonly metadataHandlerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaFunctionStackProps) {
    super(scope, id);    

    const sessionAPIHandlerFunction = new lambda.Function(scope, 'SessionHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'session-handler')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "DDB_TABLE_NAME" : props.sessionTable.tableName
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    sessionAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.sessionTable.tableArn, props.sessionTable.tableArn + "/index/*"]
    }));

    this.sessionFunction = sessionAPIHandlerFunction;

        // Define the Lambda function resource
        const websocketAPIFunction = new lambda.Function(scope, 'ChatHandlerFunction', {
          runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
          code: lambda.Code.fromAsset(path.join(__dirname, 'websocket-chat')), // Points to the lambda directory
          handler: 'index.handler', // Points to the 'hello' file in the lambda directory
          environment : {
            "WEBSOCKET_API_ENDPOINT" : props.wsApiEndpoint.replace("wss","https"),            
            "PROMPT" : `
            You are a Massachusetts state procurement assistant supporting executive offices and buyers in navigating 801 CMR regulations, the Procurement Handbook, SWC Index, and contract user guides. Base guidance strictly on the latest information in these documents.

---

### Instructions:

1. **Clarifying User Needs**:
   - For general questions (e.g., “How do I buy something?”), ask for key details like:
      - “What specific item or service do you need?”
      - “What quantity or volume is required?”
      - “Which department is making the request?”

2. **Metadata-Driven Document Selection**:
   - Use metadata (e.g., tags, summaries) internally to find the most relevant documents without mentioning metadata or internal processes in responses.
   - For instance:
      - For regulatory queries, prioritize metadata tagged with 801 CMR.
      - For purchasing questions, refer to metadata from the Procurement Handbook.

3. **Step-by-Step Guidance**:
   - Once user needs are clarified and documents selected, provide simple, step-by-step guidance using the Procurement Handbook, 801 CMR regulations, or relevant user guides.
   - **Example**: For a query like “How to purchase office supplies?”:
      - "Access SWC50 in COMMBUYS for approved vendors. Follow the SWC50 user guide for steps like vendor selection, getting quotes, and order creation."

4. **Identifying Contracts Using SWC Index**:
   - For purchases, search the SWC Index for relevant statewide contracts. Once found, guide the user on using the contract in COMMBUYS, referencing the specific user guide.

5. **Accuracy and Verification**:
   - Ensure guidance aligns with the latest Procurement Handbook, SWC Index, and contract guides. If uncertain, direct users to consult the most recent documents.

---

### Example Interaction:

**User**: “How do I buy office supplies?”

**Assistant Response**:
   - "To purchase office supplies, refer to Statewide Contract SWC50 in COMMBUYS. Follow the SWC50 user guide for steps like vendor selection and purchase order creation."

**User**: "We need IT services."

**Assistant Response**:
   - "For IT services, check Statewide Contract ITC73 in COMMBUYS. Follow the ITC73 user guide for vendor selection, compliance checks, and ordering."

`,
            'KB_ID' : props.knowledgeBase.attrKnowledgeBaseId
          },
          timeout: cdk.Duration.seconds(300)
        });
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:InvokeModel',
            
          ],
          resources: ["*"]
        }));
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:Retrieve'
          ],
          resources: [props.knowledgeBase.attrKnowledgeBaseArn]
        }));

        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:InvokeFunction'
          ],
          resources: [this.sessionFunction.functionArn]
        }));
        
        this.chatFunction = websocketAPIFunction;

    const feedbackAPIHandlerFunction = new lambda.Function(scope, 'FeedbackHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'feedback-handler')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "FEEDBACK_TABLE" : props.feedbackTable.tableName,
        "FEEDBACK_S3_DOWNLOAD" : props.feedbackBucket.bucketName
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.feedbackTable.tableArn, props.feedbackTable.tableArn + "/index/*"]
    }));

    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.feedbackBucket.bucketArn,props.feedbackBucket.bucketArn+"/*"]
    }));

    this.feedbackFunction = feedbackAPIHandlerFunction;
    
    const deleteS3APIHandlerFunction = new lambda.Function(scope, 'DeleteS3FilesHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/delete-s3')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    deleteS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.deleteS3Function = deleteS3APIHandlerFunction;

    const getS3APIHandlerFunction = new lambda.Function(scope, 'GetS3FilesHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/get-s3')), // Points to the lambda directory
      handler: 'index.handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    getS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.getS3Function = getS3APIHandlerFunction;


    const kbSyncAPIHandlerFunction = new lambda.Function(scope, 'SyncKBHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/kb-sync')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "KB_ID" : props.knowledgeBase.attrKnowledgeBaseId,      
        "SOURCE" : props.knowledgeBaseSource.attrDataSourceId  
      },
      timeout: cdk.Duration.seconds(30)
    });

    kbSyncAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:*'
      ],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn]
    }));
    this.syncKBFunction = kbSyncAPIHandlerFunction;

    const uploadS3APIHandlerFunction = new lambda.Function(scope, 'UploadS3FilesHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/upload-s3')), // Points to the lambda directory
      handler: 'index.handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    uploadS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.uploadS3Function = uploadS3APIHandlerFunction;





    // Define the Lambda function for metadata
    const metadataHandlerFunction = new lambda.Function(scope, 'MetadataHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset(path.join(__dirname, 'metadata-handler')),
      handler: 'lambda_function.lambda_handler',
      timeout: cdk.Duration.seconds(30),
      environment: {
        "BUCKET": props.knowledgeBucket.bucketName,
        "KB_ID": props.knowledgeBase.attrKnowledgeBaseId
      },
    });



    metadataHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*' ,// Grants full access to all S3 actions (read, write, delete, etc.)
        'bedrock:InvokeModel',
        'bedrock:Retrieve',
      ],
      resources: [
        props.knowledgeBucket.bucketArn,               // Grants access to the bucket itself (for actions like ListBucket)
        props.knowledgeBucket.bucketArn + "/*" ,        // Grants access to all objects within the bucket
        'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0',  // Add the Bedrock model resource explicitly
        props.knowledgeBase.attrKnowledgeBaseArn,

      ]
    }));


// Trigger the lambda function when a document is uploaded

    this.metadataHandlerFunction = metadataHandlerFunction;

      metadataHandlerFunction.addEventSource(new S3EventSource(props.knowledgeBucket, {
        events: [s3.EventType.OBJECT_CREATED],
      }));


  }
}
