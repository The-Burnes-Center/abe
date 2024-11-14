import boto3
import json
import urllib.parse
import os
from botocore.exceptions import ClientError

s3 = boto3.client('s3')
BUCKET = os.environ['BUCKET']

def filter_metadata(metadata_content, filter_key):
    try:
        metadata = json.loads(metadata_content)
        filtered_metadata = {}

        for file_key, file_metadata in metadata.items():
            if filter_key.lower() in file_key.lower():
                filtered_metadata[file_key] = file_metadata
            else:
                # Check if any metadata value contains the filter_key
                for meta_key, meta_value in file_metadata.items():
                    if isinstance(meta_value, str) and filter_key.lower() in meta_value.lower():
                        filtered_metadata[file_key] = file_metadata
                        break

        return filtered_metadata
    except json.JSONDecodeError:
        print("Error: Invalid JSON format in metadata content")
        return {}
    except Exception as e:
        print(f"Error filtering metadata: {str(e)}")
        return {}

def lambda_handler(event, context):
    filter_key = event.get('filter_key', '')
    try:
        response = s3.get_object(Bucket=BUCKET, Key='metadata.txt')
        metadata_content = response['Body'].read().decode('utf-8')
        # Apply filtering logic here based on filter_key
        filtered_metadata = filter_metadata(metadata_content, filter_key)
        return {
            'statusCode': 200,
            'body': json.dumps({'metadata': filtered_metadata})
        }
    except Exception as e:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

