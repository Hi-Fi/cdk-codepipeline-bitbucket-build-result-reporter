import * as fs from 'fs';
import * as path from 'path';
import * as cdk from '@aws-cdk/core';
import * as events from '@aws-cdk/aws-events';
import * as targets from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as lambda_nodejs from '@aws-cdk/aws-lambda-nodejs';
 
const addCodePipelineEventRule = (scope: cdk.Construct, states: string[], handler: lambda.IFunction) => {
  new events.Rule(scope, 'CodePipelineActionExecutionStateChangeRule', {
    eventPattern: {
      detailType: ['CodePipeline Action Execution State Change'],
      source: ['aws.codepipeline'],
      detail: { state: states },
    },
    targets: [new targets.LambdaFunction(handler)],
  });
};
 
export interface CodePipelineBitBucketBuildResultReporterProps {
  /**
   * The VPC in which to run the status reporter.
   */
  readonly vpc: ec2.VpcAttributes;

  /**
   * Name of the SSM parameter that contains the BitBucket access token.
   * @default BITBUCKET_UPDATE_BUILD_STATUS_TOKEN
   */
  readonly bitBucketTokenName?: string;

  /**
   * The BitBucket server address.
   */
  readonly bitBucketServerAddress: string;
}

/** A construct for reporting CodePipeline build statuses to a BitBucket server using BitBucket REST API. */
export class CodePipelineBitBucketBuildResultReporter extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: CodePipelineBitBucketBuildResultReporterProps) {
    super(scope, id);
    const bitBucketTokenName = props.bitBucketTokenName ?? 'BITBUCKET_UPDATE_BUILD_STATUS_TOKEN';

    const entry = fs.existsSync(path.join(__dirname, 'index.handler.ts'))
      ? path.join(__dirname, 'index.handler.ts') // local development
      : path.join(__dirname, 'index.handler.js') // when published in npm

    const codePipelineResultHandler = new lambda_nodejs.NodejsFunction(scope, 'CodePipelineBuildResultHandler', {
      entry,
      vpc: ec2.Vpc.fromVpcAttributes(scope, 'LambdaVpc', props.vpc),
      projectRoot: path.join(__dirname, '..'),
      runtime: lambda.Runtime.NODEJS_12_X,
      minify: true,
      description: 'Synchronize CodePipeline build statuses to BitBucket',
      externalModules: ['aws-sdk'],
      environment: {
        BITBUCKET_SERVER: props.bitBucketServerAddress,
        BITBUCKET_TOKEN: bitBucketTokenName,
      },
    });
    codePipelineResultHandler.role?.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:*:*:parameter/${bitBucketTokenName}`],
    }));
    codePipelineResultHandler.role?.addToPolicy(new iam.PolicyStatement({
      actions: ['codepipeline:GetPipelineExecution'],
      resources: ['arn:aws:codepipeline:*:*:*'],
    }));
    addCodePipelineEventRule(scope, ['FAILED', 'SUCCEEDED', 'CANCELED'], codePipelineResultHandler);
  }
}
