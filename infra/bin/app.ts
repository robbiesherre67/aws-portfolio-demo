#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { PortfolioStack } from '../lib/stack';

const app = new App();
new PortfolioStack(app, 'AwsPortfolioDemo');