import boto3
import json
from datetime import datetime

s3 = boto3.client('s3')

def lambda_handler(event, context):
    # Get the bucket and file name (key) from the event
    try:
        bucket = event['Records'][0]['s3']['bucket']['name']
        key = event['Records'][0]['s3']['object']['key']

        # Print the bucket and file name
        print(f"File uploaded: Bucket - {bucket}, Key - {key}")

        # Get the current upload time
        upload_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        # New metadata (Adding 'Awesome' and the upload time)
        new_metadata = {
            'x-amz-meta-filename': f'{key} Awesome',
            'x-amz-meta-upload-time': upload_time
        }

        # Copy the object to itself to update metadata
        s3.copy_object(
            Bucket=bucket,
            CopySource={'Bucket': bucket, 'Key': key},
            Key=key,
            Metadata=new_metadata,
            MetadataDirective='REPLACE'  # Replaces existing metadata
        )

        print(f"Metadata added: Filename - {key} Awesome, Upload time - {upload_time}")

        return {
            'statusCode': 200,
            'body': json.dumps(f"File {key} uploaded successfully with new metadata in bucket {bucket}")
        }

    except Exception as e:
        print(f"Error processing file: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps(f"Error processing file: {e}")
        }
