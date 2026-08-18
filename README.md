# CloudDrop Audit Portal

A Node.js application for the AWS scalable web application assignment.

## Elastic Beanstalk source bundle
Deploy the ZIP directly to the existing Node.js Elastic Beanstalk environment.

Required environment variables:
- DB_HOST (Secrets Manager-backed)
- DB_USER (Secrets Manager-backed)
- DB_PASSWORD (Secrets Manager-backed)
- DB_PORT (Secrets Manager-backed)
- DB_ENGINE (Secrets Manager-backed)
- DB_NAME=clouddrop
- S3_BUCKET=clouddrop-audit-files-926046661013
- AWS_REGION=ap-south-1

## Elastic Beanstalk instance role permissions
The EC2 instance profile needs:
- secretsmanager:GetSecretValue on the CloudDrop RDS secret
- s3:PutObject on arn:aws:s3:::clouddrop-audit-files-926046661013/uploads/*
- CloudWatchAgentServerPolicy for the memory metric config included in .ebextensions

## Application behavior
- `/health` health endpoint
- `/api/status` checks application/RDS/S3 configuration
- `/api/upload` uploads files to S3 and writes an RDS audit record
- `/api/events` reads recent RDS audit events
- S3 upload triggers the already configured SNS -> SQS + Lambda flow

## Docker
The included Dockerfile is for the assignment deliverable. The current Elastic Beanstalk environment uses the managed Node.js platform, so the Dockerfile is not used by that deployment.

## Lambda
`lambda/processor.mjs` is the enhanced SNS processor that writes S3 event metadata to the `clouddrop-metadata` DynamoDB table.
