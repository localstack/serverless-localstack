# LocalStack Serverless Plugin

[Serverless](https://serverless.com/) Plugin to support running against [Localstack](https://github.com/localstack/localstack).

This plugin allows Serverless applications to be deployed and tested on your local machine. Any requests to AWS to be redirected to a running LocalStack instance.

Pre-requisites:
* LocalStack

## Installation

The easiest way to get started is to install via npm.

    npm install -g serverless
    npm install --save-dev serverless-localstack

## Installation (without npm)

If you'd like to install serverless-localstack via source:

#### Clone the repository

```
git clone https://github.com/localstack/serverless-localstack
cd serverless-localstack
npm link      
```

#### Install the plugin

Use `npm link` to reference the plugin

```
cd project-path/
npm link serverless-localstack
```

## Configuring

There are two ways to configure the plugin, via a JSON file or via serverless.yml. There are two supported methods for
configuring the endpoints, globally via the "host" property, or individually. These properties may be mixed, allowing for
global override support while also override specific endpoints.

A "host" or individual endpoints must be configured or this plugin will be deactivated.

### Configuring endpoints via serverless.yml

```
service: myService

plugins:
  - serverless-localstack

custom:
  localstack:
    host: http://localhost
    endpoints:
      # This section can be used for customization but is not strictly needed
      S3: http://localhost:4572
      DynamoDB: http://localhost:4570
      CloudFormation: http://localhost:4581
      Elasticsearch: http://localhost:4571
      ES: http://localhost:4578
      SNS: http://localhost:4575
      SQS: http://localhost:4576
      Lambda: http://localhost:4574
      Kinesis: http://localhost:4568
    lambda:
      # Enable this flag to improve performance
      mountCode: True
```

### Mounting Lambda code for better performance

Note that the `localstack.lambda.mountCode` flag above will mount the local directory
into the Docker container that runs the Lambda code in LocalStack. If you remove this
flag, your Lambda code is deployed in the traditional way which is more in line with
how things work in AWS, but also comes with a performance penalty: packaging the code,
uploading it to the local S3 service, downloading it in the local Lambda API, extracting
it, and finally copying/mounting it into a Docker container to run the Lambda.

### Configuring endpoints via JSON

```
service: myService

plugins:
  - serverless-localstack

custom:
  localstack:
    endpointFile: path/to/file.json
```

### Only enable serverless-localstack for the listed stages
* ```serverless deploy --stage local``` would deploy to LocalStack.
* ```serverless deploy --stage production``` would deploy to aws.

```
service: myService

plugins:
  - serverless-localstack

custom:
  localstack:
    stages:
      - local
      - dev
    endpointFile: path/to/file.json
```

## LocalStack

For full documentation, please refer to https://github.com/localstack/localstack

## Contributing

Setting up a development environment is easy using Serverless' plugin framework.

### Clone the Repo

```
git clone https://github.com/localstack/serverless-localstack
```

### Setup your project

```
cd /path/to/serverless-localstack
npm link

cd myproject
npm link serverless-localstack
```

### Optional Debug Flag

An optional debug flag is supported via `serverless.yml` that will enable additional debug logs.

```
custom:
  localstack:
    debug: true
```

## Change Log

* v0.4.3: Support local mounting of Lambda code to improve performance
* v0.4.0: add support for local STS
