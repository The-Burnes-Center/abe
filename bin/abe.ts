#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Aspects } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ABEStack } from '../lib/abe-stack';
import { stackName } from "../lib/constants";

const app = new cdk.App();

// Account and region come from the caller's AWS credentials/profile. Every other
// per-deployment setting (custom domain, sign-up domains, eval toggle, ...) is read
// from CDK context or env vars inside the stack; see lib/deployment-config.ts.
new ABEStack(app, stackName, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
