#serverless-plugin-localstack
[Serverless](https://serverless.com/) Plugin to support running against [Atlassian Labs Localstack](https://github.com/atlassian/localstack).

WARNING: This plugin is very much WIP

Pre-requisites:
* Docker
* Docker compose
* Serverless: `npm install -g serverless`


Getting Started:

* Clone the repository
`git clone https://github.com/temyers/serverless-localstack`

* Start localstack
`docker-compose up localstack`

* Start your Serverless container:
`docker-compose run serverless-node bash`

* Install Serverless
`npm install -g serverless`

* cd to example directory
`cd /app/example/service`

* "install" the plugin
```
mkdir .serverless_plugins
ln -s /app/src .serverless_plugins/serverless-plugin-localstack
```

* Deploy the service
`serverless deploy`
