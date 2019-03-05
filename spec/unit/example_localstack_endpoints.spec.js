'use strict';
const example_endpoints = require('../../example/service/localstack_endpoints');
const expect = require('chai').expect;

describe("example/localstack_endpoints.json", () => {
  it('should have keys for each AWS service', ()=> {

    const services = [
      'APIGateway',
      'CloudFormation',
      'CloudWatch',
      'DynamoDB',
      'DynamoDBStreams',
      'ES',
      'Firehose',
      'Kinesis',
      'Lambda',
      'Redshift',
      'Route53',
      'S3',
      'SES',
      'SNS',
      'SQS',
    ]
    services.forEach( (service) => {
      expect(example_endpoints[service]).to.be.a('string', `${service} is not defined`)
    });
  });
});
