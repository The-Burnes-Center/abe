import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';

/**
 * Shared defaults applied to every application Lambda via spread: `...LAMBDA_DEFAULTS`.
 *   - ARM_64: Graviton, ~20% cheaper and faster for most workloads.
 *   - ACTIVE tracing: X-Ray enabled for end-to-end request tracing.
 *   - ONE_MONTH log retention: balances debuggability with cost.
 *
 * Individual functions override timeout and memorySize as needed.
 */
export const LAMBDA_DEFAULTS: Partial<lambda.FunctionProps> = {
  architecture: lambda.Architecture.ARM_64,
  tracing: lambda.Tracing.ACTIVE,
  logRetention: logs.RetentionDays.ONE_MONTH,
};

export const NODE_RUNTIME = lambda.Runtime.NODEJS_22_X;
export const PYTHON_RUNTIME = lambda.Runtime.PYTHON_3_12;

/**
 * Node Lambda source. Symlinks are followed so code shared by symlink (e.g.
 * shared-node/auth.mjs, generate-response/chat -> websocket-chat) is copied
 * into the package as real files. Unit tests are left out.
 */
export function nodeCode(dir: string): lambda.Code {
  return lambda.Code.fromAsset(dir, {
    followSymlinks: cdk.SymlinkFollowMode.ALWAYS,
    exclude: ['*.test.mjs', '*.test.js', '__tests__'],
  });
}

/** Test files and caches never ship inside a deployed Lambda package. */
const PYTHON_ASSET_EXCLUDE = ['test_*.py', '*_test.py', 'tests', 'conftest.py', '__pycache__', '*.pyc', '.pytest_cache'];

/** Python source with no third-party dependencies (boto3 comes from the runtime). */
export function pythonCode(dir: string): lambda.Code {
  return lambda.Code.fromAsset(dir, { exclude: PYTHON_ASSET_EXCLUDE });
}

/**
 * Python source plus the packages in its requirements.txt, installed for
 * ARM64 inside the SAM build image (Docker required at synth). Test files are
 * deleted from the output because the bundling container mounts the raw
 * directory, so asset `exclude` alone would not keep them out.
 */
export function pythonBundledCode(dir: string): lambda.Code {
  return lambda.Code.fromAsset(dir, {
    exclude: PYTHON_ASSET_EXCLUDE,
    bundling: {
      image: PYTHON_RUNTIME.bundlingImage,
      platform: 'linux/amd64',
      command: [
        'bash', '-c',
        [
          'pip install --platform manylinux2014_aarch64 --implementation cp --python-version 3.12 --only-binary=:all: -r requirements.txt -t /asset-output',
          'cp -au . /asset-output',
          "find /asset-output \\( -name 'test_*.py' -o -name '*_test.py' -o -name conftest.py \\) -delete",
          'rm -rf /asset-output/tests /asset-output/.pytest_cache',
          'find /asset-output -name __pycache__ -type d -prune -exec rm -rf {} +',
        ].join(' && '),
      ],
    },
  });
}
