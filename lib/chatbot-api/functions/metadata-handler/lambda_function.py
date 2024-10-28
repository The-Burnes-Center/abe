import boto3
import json
from datetime import datetime
from urllib.parse import unquote

s3 = boto3.client('s3')

def lambda_handler(event, context):
    try:
        # Get the bucket name and file key from the event, handling URL-encoded characters
        bucket = event['Records'][0]['s3']['bucket']['name']
        raw_key = event['Records'][0]['s3']['object']['key']
        key = unquote(raw_key)
        print(f"Processing raw file: Bucket - {bucket}, Key - {raw_key}")
        print(f"Processing file: Bucket - {bucket}, Key - {key}")

        # Get the existing metadata of the object
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
