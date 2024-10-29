import boto3
import json
from datetime import datetime
import urllib.parse


s3 = boto3.client('s3')

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
        print(f"Processing file: Bucket - {bucket}, Key - {raw_key}")
        key = urllib.parse.unquote_plus(raw_key)
        print(f"Processing file: Bucket - {bucket}, Key - {key}")
        # Get the existing metadata of the object

        # Get the object from S3
        try:
            response = s3.get_object(Bucket=bucket, Key=key)
            file_content = response['Body'].read() # Decode the byte stream to text
            print(f"File content length: {len(file_content)} characters")

            # Print the first 1000 characters of the content
            print(f"First 1000 characters of the file:\n{file_content[:1000].hex()}")

        except Exception as e:
            print(f"Error fetching content for {key}: {e}")
            return {
                'statusCode': 500,
                'body': json.dumps(f"Error fetching content for {key}: {e}")
            }

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
