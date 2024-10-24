import boto3
import json

s3 = boto3.client('s3')

def lambda_handler(event, context):
    try:
        # Retrieve properties from the custom resource event
        bucket_name = event['ResourceProperties']['BucketName']
        lambda_arn = event['ResourceProperties']['LambdaArn']
        event_types = event['ResourceProperties']['EventTypes']

        # Define the notification configuration
        notification_config = {
            'LambdaFunctionConfigurations': [
                {
                    'LambdaFunctionArn': lambda_arn,
                    'Events': event_types
                }
            ]
        }

        # Set the S3 notification configuration
        s3.put_bucket_notification_configuration(
            Bucket=bucket_name,
            NotificationConfiguration=notification_config
        )

        # Return the response to CloudFormation
        return {
            'PhysicalResourceId': f'{bucket_name}-NotificationConfig',
            'Status': 'SUCCESS'
        }

    except Exception as e:
        print(f"Error setting S3 notification: {str(e)}")
        raise e
