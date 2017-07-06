# serverless-localstack
[Serverless](https://serverless.com/) Plugin to support running against [Atlassian Labs Localstack](https://github.com/atlassian/localstack).

This plugin allows any requests to AWS to be redirected to a running Localstack instance.

WARNING: This plugin is very much WIP

Pre-requisites:
* Localstack

## Installation

The easiest way to get started is to install via npm.

    npm install -g serverless
    npm install -g serverless-localstack

## Installation (without npm)

If you'd like to install serverless-localstack via source:

#### Clone the repository
      git clone https://github.com/temyers/serverless-localstack

#### Install the plugin

In order for the plugin to be recognized it must first be enabled via the .serverless_plugins directory.

```
cd project-path/
mkdir .serverless_plugins
ln -s /absolute/path/to/plugin .serverless_plugins/serverless-plugin-localstack
```

## Configuring

There are two ways to configure the plugin, via a JSON file or via serverless.yml. There are two supported methods for
configuring the endpoints, globally via the "host" property, or individually. These properties may be mixed, allowing for
global override support while also override specific endpoints.

A "host" or individual endpoints must be configured or this plugin will be deactivated.

#### Configuring endpoints via serverless.yml 

```
service: myService

plugins:
  - serverless-plugin-localstack

custom:
  localstack:
    host: http://localhost
    endpoints:
      S3: http://localhost:4572
      DynamoDB: http://localhost:4570
      CloudFormation: http://localhost:4581
      Elasticsearch: http://localhost:4571
      ES: http://localhost:4578
      SNS: http://localhost:4575
      SQS: http://localhost:4576
      Lambda: http://localhost:4574
      Kinesis: http://localhost:4568
```

#### Configuring endpoints via JSON

```
service: myService

plugins:
  - serverless-plugin-localstack

custom:
  localstack:
    endpointFile: path/to/file.json
```

## Localstack

For full documentation, see https://bitbucket.org/atlassian/localstack

#### Installing via PIP

The easiest way to get started with Localstack is to install it via Python's pip.

```
pip install localstack
```

#### Installing via Source

Clone the repository
```
git clone git@bitbucket.org:atlassian/localstack.git
```

### Running Localstack

There are multiple ways to run Localstack.

#### Starting Localstack via Docker
  
If Localstack is installed via pip

```
localstack start --docker
```

If Localstack is installed via source

```
make docker-run
```

#### Starting Localstack without Docker

If Localstack is installed via pip

```
localstack start
```

If Localstack is installed via source

```
make infra
```

## Contributing

Setting up a development environment is easy using Serverless' plugin framework.

##### Clone the Repo

```
git clone https://github.com/temyers/serverless-localstack
```

##### Setup your project

```
cd myproject
mkdir .serverless_plugins
ln -s /absolute/path/to/serverless-localstack .serverless_plugins/serverless-localstack
```

### Optional Debug Flag

An optional debug flag is supported via serverless.yml that will enable additional debug logs.

```
custom:
  localstack:
    debug: true
```