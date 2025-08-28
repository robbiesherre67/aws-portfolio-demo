# aws-portfolio-demo
AWS Serverless Task Lab (Lambda + GraphQL + DynamoDB + ECS Fargate) + Next.js UI

A compact, résumé-ready demo that showcases:
AWS Lambda (GraphQL API behind API Gateway)
DynamoDB (on-demand)
ECS Fargate (Docker worker triggered on demand)
Infra as Code with AWS CDK (TypeScript)
Next.js front-end deployable to Vercel

Built and deployed a serverless GraphQL API on AWS Lambda behind API Gateway.
Modeled data on DynamoDB with on-demand capacity.
Triggered on-demand ECS Fargate containers for background jobs via ecs:RunTask.
Provisioned everything via AWS CDK (TypeScript).
Delivered a Next.js front-end deployed on Vercel.

Troubleshooting

Failed to build asset WorkerImage: ensure Docker Desktop is running; worker files exist; on Apple Silicon the CDK stack sets LINUX_AMD64 image and X86_64 task architecture.
AccessDenied iam:PassRole or ecs:RunTask: your IAM user needs permission to pass the task/execution roles (AdministratorAccess in a sandbox is simplest).
CORS issues: set NEXT_PUBLIC_GRAPHQL_URL correctly; restrict or widen CORS in lib/stack.ts corsPreflight as needed.
GitHub >100MB error: don’t commit node_modules, .next, dist, cdk.out. Use the included .gitignore.
