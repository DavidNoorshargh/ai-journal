---
name: amazon-bedrock
description: >-
  Load the live amazon-bedrock AWS skill before changing this journal's agent,
  Knowledge Base, Nova model, or AgentCore runtime. Use when editing agent/,
  the Bedrock or AgentCore Terraform, retrieval, or when the user mentions
  Bedrock, AgentCore, Knowledge Bases, Nova, Titan, or Strands.
---

# Amazon Bedrock for this journal

Load the live AWS skill before answering or editing. Call the AWS knowledge tool `retrieve_skill` with `skill_name` `amazon-bedrock`. Fetch a reference or script with the `file` parameter. Those files are not on disk.

The live skill prefers a Managed Knowledge Base and the AgentCore Harness. This journal does not. Keep the choices below when they differ.

## Locked choices

- Region is `eu-west-2`.
- The chat model is `amazon.nova-lite-v1:0`. Embeddings stay on Titan Text Embeddings V2. The Knowledge Base is the existing customer-managed one with S3 Vectors. Do not migrate it to a Managed Knowledge Base or recreate the index.
- The agent is the Python zip on AgentCore Runtime. Do not move it to the AgentCore Harness or to classic Bedrock Agents.
- One turn is one `search_entries` call, then a forced summary. Python applies the date window, the score cutoff, and the citation ids. Do not add Strands, LangGraph, a second search, or another tool unless the user asks.
- Bedrock invocation logging stays off. Do not print journal entry bodies.
- Apply the main stack from the GitHub Actions pipeline, not from the laptop.
