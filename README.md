[![Build Status](https://travis-ci.org/localstack/serverless-localstack.svg?branch=master)](https://travis-ci.org/localstack/serverless-localstack)

# LocalStack Serverless Plugin

[Serverless](https://serverless.com/) Plugin to support running against [Localstack](https://github.com/localstack/localstack).

This plugin allows Serverless applications to be deployed and tested on your local machine. Any requests to AWS to be redirected to a running LocalStack instance.

Pre-requisites:
* LocalStack

## Installation

The easiest way to get started is to install via npm.

    npm install -g serverless
    npm install --save-dev serverless-localstack

## Configuring

The plugin can be configured via `serverless.yml`, or alternatively via environment variables.

There are two supported methods for configuring the endpoints, globally via the
`host` property, or individually. These properties may be mixed, allowing for
global override support while also override specific endpoints.

A `host` or individual endpoints must be configured, or this plugin will be deactivated.

### Configuration via serverless.yml

Please refer to the example configuration template below. (Please note that most configurations
in the sample are optional and need not be specified.)

```
service: myService

plugins:
  - serverless-localstack

custom:
  localstack:
    stages:
      # list of stages for which the plugin should be enabled
      - local
    host: http://localhost  # optional - LocalStack host to connect to
    edgePort: 4566  # optional - LocalStack edge port to connect to
    autostart: true  # optional - Start LocalStack in Docker on Serverless deploy
    networks: #optional - attaches the list of networks to the localstack docker container after startup
      - host
      - overlay
      - my_custom_network
    lambda:
      # Enable this flag to improve performance
      mountCode: true  # specify either "true", or a relative path to the root Lambda mount path
    docker:
      # Enable this flag to run "docker ..." commands as sudo
      sudo: False
      compose_file: /home/localstack_compose.yml # optional to use docker compose instead of docker or localstack cli
  stages:
    local:
      ...
```

### Configuration via environment variables

The following environment variables can be configured (taking precedence over the values in `serverless.yml`):
* `AWS_ENDPOINT_URL`: LocalStack endpoint URL to connect to (default: `http://localhost:4566`). This is the recommended configuration, and replaces the deprecated config options (`EDGE_PORT`/`LOCALSTACK_HOSTNAME`/`USE_SSL`) below.
* `EDGE_PORT`: LocalStack edge port to connect to (deprecated; default: `4566`)
* `LOCALSTACK_HOSTNAME`: LocalStack host name to connect to (deprecated; default: `localhost`)
* `USE_SSL`: Whether to use SSL/HTTPS when connecting to the LocalStack endpoint (deprecated)

### Activating the plugin for certain stages

Note the `stages` attribute in the config above. The `serverless-localstack` plugin gets activated if either:
  1. the serverless stage (explicitly defined or default stage "dev") is included in the `stages` config; or
  2. serverless is invoked without a `--stage` flag (default stage "dev") and no `stages` config is provided

### Mounting Lambda code for better performance

Note that the `localstack.lambda.mountCode` flag above will mount the local directory into
the Docker container that runs the Lambda code in LocalStack. You can either specify the boolean
value `true` (to mount the project root folder), or a relative path to the root Lambda mount path
within your project (e.g., `./functions`).

If you remove this flag, your Lambda code is deployed in the traditional way which is more in
line with how things work in AWS, but also comes with a performance penalty: packaging the code,
uploading it to the local S3 service, downloading it in the local Lambda API, extracting
it, and finally copying/mounting it into a Docker container to run the Lambda. Mounting code
from multiple projects is not supported with simple configuration, and you must use the
`autostart` feature, as your code will be mounted in docker at start up. If you do need to
mount code from multiple serverless projects, manually launch
localstack with volumes specified. For example:

```sh
localstack start --docker -d \
  -v /path/to/project-a:/path/to/project-a \
  -v /path/to/project-b:/path/to/project-b
```

If you use either `serverless-webpack`, `serverless-plugin-typescript`, or `serverless-esbuild`, `serverless-localstack`
will detect it and modify the mount paths to point to your output directory. You will need to invoke
the build command in order for the mounted code to be updated. (eg: `serverless webpack`). There is no
`--watch` support for this out of the box, but could be accomplished using nodemon:

```sh
npm i --save-dev nodemon
```

Webpack example's `package.json`:

```json
  "scripts": {
    "build": "serverless webpack --stage local",
    "deploy": "serverless deploy --stage local",
    "watch": "nodemon -w src -e '.*' -x 'npm run build'",
    "start": "npm run deploy && npm run watch"
  },
```

```sh
npm run start
```

#### A note on using webpack

`serverless-webpack` is supported, with code mounting. However, there are some assumptions
and configuration requirements. First, your output directory must be `.webpack`. Second, you must retain
your output directory contents. You can do this by modifying the `custom > webpack` portion of your
serverless configuration file.

```yml
custom:
  webpack:
    webpackConfig: webpack.config.js
    includeModules: true
    keepOutputDirectory: true
  localstack:
    stages:
      - local
    lambda:
      mountCode: true
    autostart: true
```

### Environment Configurations

* `LAMBDA_MOUNT_CWD`: Allow users to define a custom working directory for Lambda mounts.
   For example, when deploying a Serverless app in a Linux VM (that runs Docker) on a
   Windows host where the `-v <local_dir>:<cont_dir>` flag to `docker run` requires us
   to specify a `local_dir` relative to the Windows host file system that is mounted
   into the VM (e.g., `"c:/users/guest/..."`).
* `LAMBDA_EXECUTOR`: Executor type to use for running Lambda functions (default `docker`) -
   see [LocalStack repo](https://github.com/localstack/localstack)
* `LAMBDA_REMOTE_DOCKER`: Whether to assume that we're running Lambda containers against
   a remote Docker daemon (default `false`) - see [LocalStack repo](https://github.com/localstack/localstack)
* `BUCKET_MARKER_LOCAL`: Magic S3 bucket name for Lambda mount and [Hot Reloading](https://docs.localstack.cloud/user-guide/tools/lambda-tools/hot-reloading/).

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
* v1.3.1: prevent the mounting of code if the Lambda uses an ECR Image
* v1.3.0: add support for built-in Esbuild in Serverless Framework v4 #267
* v1.2.1: Fix custom-resource bucket compatibility with serverless >3.39.0, continue improving support for `AWS_ENDPOINT_URL`
* v1.2.0: Add docker-compose config and fix autostart when plugin is not active 
* v1.1.3: Fix replacing host from environment variable `AWS_ENDPOINT_URL`
* v1.1.2: Unify construction of target endpoint URL, add support for configuring `AWS_ENDPOINT_URL`
* v1.1.1: Fix layer deployment if `mountCode` is enabled by always packaging and deploying
* v1.1.0: Fix SSM environment variables resolving issues with serverless v3, change default for `BUCKET_MARKER_LOCAL` to `hot-reload`
* v1.0.6: Add `BUCKET_MARKER_LOCAL` configuration for customizing S3 bucket for lambda mount and [Hot Reloading](https://docs.localstack.cloud/user-guide/tools/lambda-tools/hot-reloading/).
* v1.0.5: Fix S3 Bucket LocationConstraint issue when the provider region is `us-east-1`
* v1.0.4: Fix IPv4 fallback check to prevent IPv6 connection issue with `localhost` on macOS
* v1.0.3: Set S3 Path addressing for internal Serverless Custom Resources - allow configuring S3 Events Notification for functions
* v1.0.2: Add check to prevent IPv6 connection issue with `localhost` on MacOS
* v1.0.1: Add support for Serverless projects with esbuild source config; enable config via environment variables
* v1.0.0: Allow specifying path for mountCode, to point to a relative Lambda mount path
* v0.4.36: Add patch to avoid "TypeError" in AwsDeploy plugin on Serverless v3.4.0+
* v0.4.35: Add config option to connect to additional Docker networks
* v0.4.33: Fix parsing StepFunctions endpoint if the endpointInfo isn't defined
* v0.4.32: Add endpoint to AWS credentials for compatibility with serverless-domain-manager plugin
* v0.4.31: Fix format of API GW endpoints printed in stack output
* v0.4.30: Fix plugin for use with Serverless version 2.30+
* v0.4.29: Add missing service endpoints to config
* v0.4.28: Fix plugin activation for variable refs in profile names
* v0.4.27: Fix loading of endpoints file with variable references to be resolved
* v0.4.26: Fix resolution of template variables during plugin initialization
* v0.4.25: Use single edge port instead of deprecated service-specific ports
* v0.4.24: Fix resolving of stage/profiles via variable expansion
* v0.4.23: Fix config loading to enable file imports; fix output of API endpoints if plugin is not activated; enable SSM and CF output refs by performing early plugin loading
* v0.4.21: Fix integration with `serverless-plugin-typescript` when `mountCode` is enabled
* v0.4.20: Use `LAMBDA_EXECUTOR`/`LAMBDA_REMOTE_DOCKER` configurations from environment
* v0.4.19: Fix populating local test credentials in AWS provider
* v0.4.18: Fix output of API Gateway endpoints; add port mappings; fix config init code
* v0.4.17: Enable configuration of `$START_WEB`
* v0.4.16: Add option for running Docker as sudo; add fix for downloadPackageArtifacts
* v0.4.15: Enable plugin on aws:common:validate events
* v0.4.14: Initialize LocalStack using hooks for each "before:" event
* v0.4.13: Add endpoint for SSM; patch serverless-secrets plugin; allow customizing $DOCKER_FLAGS
* v0.4.12: Fix Lambda packaging for `mountCode:false`
* v0.4.11: Add polling loop for starting LocalStack in Docker
* v0.4.8: Auto-create deployment bucket; autostart LocalStack in Docker
* v0.4.7: Set S3 path addressing; add eslint to CI config
* v0.4.6: Fix port mapping for service endpoints
* v0.4.5: Fix config to activate or deactivate the plugin for certain stages
* v0.4.4: Add `LAMBDA_MOUNT_CWD` configuration for customizing Lambda mount dir
* v0.4.3: Support local mounting of Lambda code to improve performance
* v0.4.0: Add support for local STS
