import os
import boto3
import subprocess
import json

s3 = boto3.client('s3')

print("Accessed lambda function")

import json

def lambda_handler(event, context):
    # Get the bucket and file name from the event
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = event['Records'][0]['s3']['object']['key']

    # Print the file name (S3 object key)
    print(f"File uploaded: {key}")

    return {
        'statusCode': 200,
        'body': json.dumps(f'File {key} uploaded successfully!')
    }

# def lambda_handler(event, context):
#     # Get the bucket and file name from the event
#     bucket = event['Records'][0]['s3']['bucket']['name']
#     key = event['Records'][0]['s3']['object']['key']
#
#     # Retrieve the file from S3
#     try:
#         response = s3.get_object(Bucket=bucket, Key=key)
#         file_content = response['Body'].read().decode('utf-8')
#
#         # Call Claude for summarization
#         summary = summarize_file(file_content)
#
#         # Output or log the summary (you can store it, print, or send it to another service)
#         print(f"File Summary: {summary}")
#         return {
#             'statusCode': 200,
#             'body': json.dumps('Summary generated successfully!')
#         }
#     except Exception as e:
#         print(f"Error processing file: {e}")
#         return {
#             'statusCode': 500,
#             'body': json.dumps(f"Error processing file: {e}")
#         }
#
# def summarize_file(file_content):
#     # Run Claude's JS file using Node.js subprocess
#     try:
#         process = subprocess.Popen(
#             ['node', 'claude.mjs', file_content],
#             stdout=subprocess.PIPE,
#             stderr=subprocess.PIPE
#         )
#         output, error = process.communicate()
#
#         if error:
#             print(f"Error running Claude: {error.decode('utf-8')}")
#             return None
#
#         # Parse the output from Claude
#         return output.decode('utf-8')
#     except Exception as e:
#         print(f"Failed to run Claude subprocess: {e}")
#         return None
