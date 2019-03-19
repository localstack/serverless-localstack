[![Build Status](https://travis-ci.org/localstack/serverless-localstack.svg)](https://travis-ci.org/localstack/serverless-localstack)

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

There are two ways to configure the plugin, via a JSON file or via `serverless.yml`.
There are two supported methods for configuring the endpoints, globally via the
`host` property, or individually. These properties may be mixed, allowing for
global override support while also override specific endpoints.

A `host` or individual endpoints must be configured or this plugin will be deactivated.

### Configuration via serverless.yml

```
service: myService

plugins:
  - serverless-localstack

custom:
  localstack:
    host: http://localhost
    stages:
      # list of stages for which the plugin should be enabled
      - local
    autostart: true  # optional - start LocalStack in Docker on Serverless deploy
    endpoints:
      # This section is optional - can be used for customizing the target endpoints
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
  stages:
    local:
      ...
```

### Activating the plugin for certain stages

Note the `stages` attribute in the config above. The `serverless-localstack` plugin gets activated if either:
  1. `serverless` is invoked with the default stage ("dev") and no `stages` config is provided; or
  2. `serverless` is invoked with a `--stage` flag and this stage is included in the `stages` config

### Mounting Lambda code for better performance

Note that the `localstack.lambda.mountCode` flag above will mount the local directory
into the Docker container that runs the Lambda code in LocalStack. If you remove this
flag, your Lambda code is deployed in the traditional way which is more in line with
how things work in AWS, but also comes with a performance penalty: packaging the code,
uploading it to the local S3 service, downloading it in the local Lambda API, extracting
it, and finally copying/mounting it into a Docker container to run the Lambda.

### Environment Configurations

* `LAMBDA_MOUNT_CWD`: Allow users to define a custom working directory for Lambda mounts.
   For example, when deploying a Serverless app in a Linux VM (that runs Docker) on a
   Windows host where the `-v <local_dir>:<cont_dir>` flag to `docker run` requires us
   to specify a `local_dir` relative to the Windows host file system that is mounted
   into the VM (e.g., `"c:/users/guest/..."`).

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

* v0.4.11: Add polling loop for starting LocalStack in Docker
* v0.4.8: Auto-create deployment bucket; autostart LocalStack in Docker
* v0.4.7: Set S3 path addressing; add eslint to CI config
* v0.4.6: Fix port mapping for service endpoints
* v0.4.5: Fix config to activate or deactivate the plugin for certain stages
* v0.4.4: Add `LAMBDA_MOUNT_CWD` configuration for customizing Lambda mount dir
* v0.4.3: Support local mounting of Lambda code to improve performance
* v0.4.0: Add support for local STS
