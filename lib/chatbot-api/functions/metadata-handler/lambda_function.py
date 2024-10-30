import boto3
import json
from datetime import datetime
import urllib.parse
import base64
import os
from botocore.exceptions import ClientError



s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-runtime')
kb_id = os.environ['KB_ID']


def retrieve_kb_docs(query, knowledge_base_id):
    try:
        payload = {
            "knowledgeBaseId": knowledge_base_id,
            "retrievalQuery": {
                "text": query
            },
            "retrievalConfiguration": {
                "vectorSearchConfiguration": {
                    "numberOfResults": 10
                }
            }
        }

        response = bedrock.invoke_model(
            modelId='anthropic.claude-3-sonnet-20240229-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "messages": [
                    {"role": "system",
                     "content": "You are an AI assistant that retrieves information from a knowledge base."},
                    {"role": "user",
                     "content": f"Retrieve information about the following query from the knowledge base: {query}"}
                ]
            })
        )

        result = json.loads(response['body'].read())
        return result['content'][0]['text']
    except ClientError as e:
        print(f"Error fetching knowledge base docs: {e}")
        return "Error occurred while searching the knowledge base."


def get_claude_response(query, context):
    try:
        response = bedrock.invoke_model(
            modelId="anthropic.claude-3-sonnet-20240229-v1:0",
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1000,
                "messages": [
                    {"role": "system",
                     "content": "You are an AI assistant that provides summary of the document in 200 characters max. Always refer to the context when answering."},
                    {"role": "user", "content": f"Context: {context}\n\nQuestion: {query}"}
                ]
            })
        )

        result = json.loads(response['body'].read())
        return result['content'][0]['text']
    except Exception as e:
        print(f"Error invoking Claude: {e}")
        return "Error occurred while generating a response."


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
        file_name = os.path.splitext(os.path.basename(key))[0]

        # Retrieve the document content from the knowledge base
        document_content = retrieve_kb_docs(file_name, kb_id)
        if "Error occurred" in document_content:
            return {
                'statusCode': 500,
                'body': json.dumps("Error retrieving document content from knowledge base")
            }
        # Define your custom query here
        custom_query = "Provide a detailed summary of this document, including its main topics and key points."

        # Get Claude's response
        claude_response = get_claude_response(custom_query, document_content)
        print(f"Response summary : {claude_response}")
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
