"""Generate the ABE architecture diagram using the Python diagrams DSL.

Render with:
    python3 -m venv .venv && . .venv/bin/activate
    pip install diagrams           # requires the graphviz `dot` binary on PATH
    python docs/generate_architecture.py
Produces docs/architecture.png.

Keep this in step with lib/chatbot-api/index.ts (routes) and
lib/chatbot-api/functions/*.ts (Lambdas) when the architecture changes.
"""
import os
from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.network import CloudFront, APIGateway
from diagrams.aws.security import WAF, Cognito
from diagrams.aws.ml import Bedrock
from diagrams.aws.integration import SQS, StepFunctions, SNS, Eventbridge
from diagrams.aws.storage import S3
from diagrams.aws.analytics import AmazonOpensearchService
from diagrams.aws.management import Cloudwatch
from diagrams.onprem.client import Users

os.chdir(os.path.dirname(os.path.abspath(__file__)))

graph_attr = {
    "fontsize": "22",
    "fontname": "Helvetica",
    "bgcolor": "white",
    "pad": "0.5",
    "nodesep": "0.5",
    "ranksep": "1.1",
    "labelloc": "b",
    "splines": "spline",
}

edge_attr = {
    "color": "#555555",
    "penwidth": "1.4",
    "fontsize": "10",
    "fontname": "Helvetica",
}

node_attr = {
    "fontsize": "11",
    "fontname": "Helvetica",
}

with Diagram(
    "ABE \u00b7 AI for Impact",
    show=False,
    filename="architecture",
    outformat="png",
    direction="LR",
    graph_attr=graph_attr,
    edge_attr=edge_attr,
    node_attr=node_attr,
):
    users = Users("Users\n(browser)")

    with Cluster("Web app and sign-in"):
        waf = WAF("WAF\n(us-east-1 only)")
        cf = CloudFront("CloudFront")
        site = S3("S3\nReact app")
        cognito = Cognito("Cognito user pool\nemail + password, TOTP\nAdmin group, invite-only")
        presignup = Lambda("PreSignUp\n(domain allowlist)")

    with Cluster("APIs"):
        http = APIGateway("HTTP API\n(Cognito JWT)")
        ws = APIGateway("WebSocket API\n(JWT authorizer on $connect)")

    with Cluster("Chat"):
        chat = Lambda("Chat Lambda\n(agentic tool loop)")
        claude = Bedrock("Bedrock\nClaude Opus 4.6 / Sonnet 4.6")
        kb = Bedrock("Bedrock\nKnowledge Base")
        aoss = AmazonOpensearchService("OpenSearch\nServerless")
        idx_query = Lambda("Excel index\nquery")
        helpers = Lambda("Helper Lambdas\nmetadata retrieval,\ncontext summarizer,\nFAQ classifier")

    app_fns = Lambda("App and admin Lambdas\nsessions, feedback, metrics,\nusers, documents, indexes,\nsync schedule, presign")
    ddb = Dynamodb("DynamoDB\nsessions, feedback, traces,\nprompts, analytics")

    with Cluster("Knowledge sources and sync"):
        staging = S3("S3 staging bucket\ndocuments/ indexes/")
        orchestrator = Lambda("Sync orchestrator")
        scheduler = Eventbridge("EventBridge Scheduler\nweekly sync, hourly backfill")
        kb_s3 = S3("S3 knowledge bucket")
        meta_fn = Lambda("Metadata handler\n(document summaries)")
        idx_s3 = S3("S3 index bucket\nindexes/{id}/latest.xlsx")
        parser = Lambda("Excel parser")
        idx_ddb = Dynamodb("DynamoDB\nExcel index + registry")

    with Cluster("Quality (eval is optional: enableEval)"):
        sqs = SQS("SQS + DLQ\n(admin-promoted feedback)")
        process = Lambda("Test library\nprocess")
        sfn = StepFunctions("Step Functions\nRAGAS evaluation")
        eval_store = Dynamodb("DynamoDB + S3\ntest library, results")

    with Cluster("Monitoring"):
        cw = Cloudwatch("CloudWatch\ndashboard + alarms")
        sns = SNS("SNS email")

    # Web delivery and sign-in
    users >> waf >> cf >> site
    users >> Edge(label="sign in", style="dashed") >> cognito
    cognito >> Edge(style="dashed", label="trigger") >> presignup
    users >> Edge(label="REST") >> http
    users >> Edge(label="chat stream") >> ws

    # Chat flow and the four tools
    ws >> chat
    chat >> Edge(label="LLM") >> claude
    chat >> Edge(label="query_db,\nretrieve_full_document") >> kb >> aoss
    chat >> Edge(label="query_excel_index") >> idx_query >> idx_ddb
    chat >> Edge(label="fetch_metadata") >> helpers
    chat >> Edge(label="history") >> ddb

    # REST routes
    http >> app_fns >> ddb
    app_fns >> Edge(label="invites,\nroles") >> cognito
    app_fns >> Edge(label="presigned PUT\n(browser uploads direct)") >> kb_s3
    app_fns >> Edge(label="presigned PUT") >> idx_s3
    app_fns >> Edge(label="sync now") >> orchestrator
    http >> Edge(label="run eval") >> sfn >> eval_store
    app_fns >> Edge(label="promote\nfeedback") >> sqs >> process >> eval_store

    # Ingestion
    kb_s3 >> Edge(label="ingestion") >> kb
    kb_s3 >> Edge(label="S3 event") >> meta_fn >> claude
    idx_s3 >> Edge(label="S3 event") >> parser >> idx_ddb
    scheduler >> orchestrator
    staging >> orchestrator
    orchestrator >> Edge(label="documents") >> kb_s3
    orchestrator >> Edge(label="indexes") >> idx_s3
    orchestrator >> Edge(label="start ingestion") >> kb
    orchestrator >> Edge(label="backfill", style="dashed") >> meta_fn

    # Monitoring
    cw >> sns
