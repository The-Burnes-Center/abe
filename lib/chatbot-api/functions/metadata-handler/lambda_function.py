import boto3
import json
from datetime import datetime
import urllib.parse
import os
from botocore.exceptions import ClientError
from config import get_full_prompt, get_all_tags, CATEGORIES, CUSTOM_TAGS



s3 = boto3.client('s3')
bedrock = boto3.client('bedrock-agent-runtime', region_name = 'us-east-1')
bedrock_invoke =boto3.client('bedrock-runtime', region_name = 'us-east-1')
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
        response = bedrock_invoke.invoke_model(
            modelId='anthropic.claude-3-5-sonnet-20240620-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 500,
                "messages": [
                    {
                        "role": "user",
                        "content": get_full_prompt(content)
                    }
                ]
            })
        )

        result = json.loads(response['body'].read())
        summary_and_tags = json.loads(result['content'][0]['text'])
        # Validate the tags
        all_tags = get_all_tags()
        for tag, value in summary_and_tags['tags'].items():
            if tag not in all_tags or value not in all_tags[tag]:
                summary_and_tags['tags'][tag] = 'unknown'

        return summary_and_tags
    except Exception as e:
        print(f"Error generating summary and tags: {e}")
        return {"summary": "Error generating summary", "tags": {"category": "unknown"}}

def get_metadata(bucket,key):
    response = s3.head_object(Bucket=bucket, Key=key)
    existing_metadata = response.get('Metadata', {})
    return existing_metadata

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

        # Retrieve the document content from the knowledge base
        print(f"file : {key}, kb_id : {kb_id}")
        document_content = retrieve_kb_docs(key, kb_id)
        if "Error occurred" in document_content:
            return {
                'statusCode': 500,
                'body': json.dumps("Error retrieving document content from knowledge base")
            }
        else:
            print(f"Content : {document_content}")

        summary_and_tags = summarize_and_categorize(document_content)
        if "Error generating summary" in summary_and_tags['summary']:
            return {
                'statusCode': 500,
                'body': json.dumps("Error generating summary and tags")
            }
        else:
            print(f"Summary and category : {summary_and_tags}")




        try:
            existing_metadata = get_metadata(bucket,key)
        except Exception as e:
            print(f"Error fetching metadata for {key}: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps(f"Error fetching metadata for {key}: {e}")
            }

        # Generate new metadata fields
        # upload_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        new_metadata = {
            'summary': summary_and_tags['summary'],
            **{f"tag_{k}": v for k, v in summary_and_tags['tags'].items()}
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
