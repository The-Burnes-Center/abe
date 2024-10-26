import boto3
import json

s3 = boto3.client('s3')

print("Accessed lambda function")


def lambda_handler(event, context):
    # Get the bucket and file name (key) from the event
    try:
        bucket = event['Records'][0]['s3']['bucket']['name']
        key = event['Records'][0]['s3']['object']['key']

        # Print the bucket and file name
        print(f"File uploaded: Bucket - {bucket}, Key - {key}")

        return {
            'statusCode': 200,
            'body': json.dumps(f"File {key} uploaded successfully in bucket {bucket}")
        }

    except Exception as e:
        print(f"Error processing file: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps(f"Error processing file: {e}")
        }
