import boto3
import json
from datetime import datetime
import urllib.parse
import base64
import os
from botocore.exceptions import ClientError



s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-agent-runtime', region_name = 'us-east-1')
kb_id = os.environ['KB_ID']


def retrieve_kb_docs(file_name, knowledge_base_id):
    try:
        response = bedrock.retrieve(
            knowledgeBaseId=knowledge_base_id,
            retrievalQuery={
                'text': file_name
            },
            retrievalConfiguration={
                'vectorSearchConfiguration': {
                    'numberOfResults': 20  # We only want the most relevant document
                }
            }
        )
        print(f"Raw response : {response}")
        full_content = []
        file_uri = []
        if response['retrievalResults']:
            for result in response['retrievalResults']:
                uri = result['location']['s3Location']['uri']
                if file_name in uri:
                    full_content.append(result['content']['text'])
                    file_uri = uri
            return {
                'content': full_content,
                'uri': file_uri
            }

        else:
            return {
                'content': "No relevant document found in the knowledge base.",
                'uri': None
            }
    except ClientError as e:
        print(f"Error fetching knowledge base docs: {e}")
        return {
            'content': "Error occurred while searching the knowledge base.",
            'uri': None
        }


def summarize_and_categorize(content):
    try:
        # Use Bedrock's Claude model to generate summary and category
        response = bedrock.invoke_model(
            modelId='anthropic.claude-3-sonnet-20240229-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 500,
                "messages": [
                    {"role": "system",
                     "content": "You are an AI assistant that summarizes documents and categorizes them."},
                    {"role": "user",
                     "content": f"Summarize the following document in about 100 words. Then, categorize it as either 'user guide', 'handbook', 'unknown', or 'swc index'. Provide your response in JSON format with keys 'summary' and 'category'.\n\nDocument: {content}"}
                ]
            })
        )

        result = json.loads(response['body'].read())
        summary_and_category = json.loads(result['content'][0]['text'])
        return summary_and_category
    except Exception as e:
        print(f"Error generating summary and category: {e}")
        return {"summary": "Error generating summary", "category": "unknown"}

def lambda_handler(event, context):
    try:
        # Check if the event is caused by the Lambda function itself
        if event['Records'][0]['eventSource'] == 'aws:s3' and \
           event['Records'][0]['eventName'].startswith('ObjectCreated:Copy'):
            print("Skipping event triggered by copy operation")
            return {
                'statusCode': 200,
                'body': json.dumps("Skipped event triggered by copy operation")
            }

    except:
        print("Issue checking for s3 action")


    try:
        # Get the bucket name and file key from the event, handling URL-encoded characters
        bucket = event['Records'][0]['s3']['bucket']['name']
        raw_key = event['Records'][0]['s3']['object']['key']
        key = urllib.parse.unquote_plus(raw_key)
        print(f"Processing file: Bucket - {bucket}, File - {key}")
        # Extract file name without extension
        # file_name = os.path.splitext(os.path.basename(raw_key))[0]

        # Retrieve the document content from the knowledge base
        print(f"file : {key}, kb_id : {kb_id}")
        document_content = retrieve_kb_docs(key, kb_id)
        summary_and_category = summarize_and_categorize(document_content)
        print(f"Summary and category : {summary_and_category}")
        if "Error occurred" in document_content:
            return {
                'statusCode': 500,
                'body': json.dumps("Error retrieving document content from knowledge base")
            }

        print(f"Content : {document_content}")

        try:
            response = s3.head_object(Bucket=bucket, Key=key)
            existing_metadata = response.get('Metadata', {})
        except Exception as e:
            print(f"Error fetching metadata for {key}: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps(f"Error fetching metadata for {key}: {e}")
            }

        # Generate new metadata fields
        upload_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        new_metadata = {
            'filename': f"{key} Awesome",
            'upload-time': upload_time
        }

        # Merge new metadata with any existing metadata
        updated_metadata = {**existing_metadata, **new_metadata}

        # Copy the object to itself to update metadata
        try:
            s3.copy_object(
                Bucket=bucket,
                CopySource={'Bucket': bucket, 'Key': key},
                Key=key,
                Metadata=updated_metadata,
                MetadataDirective='REPLACE'
            )
            print(f"Metadata successfully updated for {key}: {updated_metadata}")
        except Exception as e:
            print("Error in copying file copy")
            print(f"Error updating metadata for {key}: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps(f"Error updating metadata for {key}: {e}")
            }

        return {
            'statusCode': 200,
            'body': json.dumps(f"File {key} metadata updated successfully in bucket {bucket}")
        }

    except Exception as e:
        print(f"Unexpected error processing file: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps(f"Unexpected error processing file: {e}")
        }
