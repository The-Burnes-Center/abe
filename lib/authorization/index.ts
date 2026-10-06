import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';
import { brand } from '../../config/brand';
import { ADMIN_GROUP_NAME } from '../constants';
import { LAMBDA_DEFAULTS, PYTHON_RUNTIME, pythonBundledCode, pythonCode } from '../shared/lambda-defaults';

export interface AuthorizationStackProps {
  /**
   * Email domains allowed to self-register. Empty = invite-only: self sign-up
   * is disabled and users are created by an admin (AdminCreateUser).
   */
  readonly allowedSignupDomains: string[];
  /** Cognito feature plan. PLUS adds threat protection (extra per-MAU cost). */
  readonly featurePlan: 'ESSENTIALS' | 'PLUS';
  /** URL users sign in at, included in the invitation email. */
  readonly siteUrl: string;
}

/**
 * Native Cognito sign-in: email + password (SRP) with optional TOTP MFA.
 * No hosted UI, no federation, no SMS. Admins are members of the `Admin` group.
 */
export class AuthorizationStack extends Construct {
  public readonly lambdaAuthorizer: lambda.Function;
  public readonly preSignUpFunction: lambda.Function;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly selfSignUpEnabled: boolean;

  constructor(scope: Construct, id: string, props: AuthorizationStackProps) {
    super(scope, id);

    this.selfSignUpEnabled = props.allowedSignupDomains.length > 0;

    // Always wired, even when self sign-up is off, so the SignUp API stays
    // closed to non-allowlisted domains if someone flips the pool setting in
    // the console. Admin-created users always pass.
    const preSignUpFunction = new lambda.Function(this, 'PreSignUpFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonCode(path.join(__dirname, 'pre-signup')),
      handler: 'lambda_function.lambda_handler',
      environment: {
        ALLOWED_SIGNUP_DOMAINS: props.allowedSignupDomains.join(','),
      },
      timeout: cdk.Duration.seconds(5),
    });
    this.preSignUpFunction = preSignUpFunction;

    const isPlus = props.featurePlan === 'PLUS';

    // The logical ID is not the original 'UserPool': moving to the email-only,
    // no-SMS, no-custom:role schema needs a fresh pool (Cognito cannot drop
    // attributes in place), and a new ID makes CloudFormation create it cleanly.
    const userPool = new cognito.UserPool(this, 'AppUserPool', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: true,
      selfSignUpEnabled: this.selfSignUpEnabled,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: isPlus ? cognito.FeaturePlan.PLUS : cognito.FeaturePlan.ESSENTIALS,
      standardThreatProtectionMode: isPlus ? cognito.StandardThreatProtectionMode.FULL_FUNCTION : undefined,
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      userInvitation: {
        emailSubject: `You have been invited to ${brand.assistantName}`,
        emailBody: [
          `You have been invited to ${brand.assistantName}.`,
          '<br><br>Sign in at ' + props.siteUrl + ' with:',
          '<br>Email: {username}',
          '<br>Temporary password: {####}',
          '<br><br>You will be asked to choose a new password. The temporary password expires in 7 days.',
        ].join(''),
      },
      lambdaTriggers: {
        preSignUp: preSignUpFunction,
      },
    });
    this.userPool = userPool;

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: ADMIN_GROUP_NAME,
      description: 'Administrators: access to the admin pages and admin APIs.',
    });

    // Public SPA client: no secret, SRP only (the password never leaves the
    // browser), no OAuth/hosted UI. Refresh-token auth is added implicitly.
    // Users can edit their own profile fields but nothing that confers access;
    // admin rights come only from group membership, which a user's own token
    // cannot change.
    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
        user: false,
      },
      disableOAuth: true,
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        emailVerified: true,
        fullname: true,
        givenName: true,
        familyName: true,
      }),
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        fullname: true,
        givenName: true,
        familyName: true,
      }),
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      authSessionValidity: cdk.Duration.minutes(3),
      enableTokenRevocation: true,
    });
    this.userPoolClient = userPoolClient;

    // WebSocket $connect authorizer: validates the Cognito ID token passed in
    // the query string (browsers can't set headers on a WebSocket upgrade).
    const authorizerHandlerFunction = new lambda.Function(this, 'AuthorizationFunction', {
      ...LAMBDA_DEFAULTS,
      runtime: PYTHON_RUNTIME,
      code: pythonBundledCode(path.join(__dirname, 'websocket-api-authorizer')),
      handler: 'lambda_function.lambda_handler',
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        APP_CLIENT_ID: userPoolClient.userPoolClientId,
      },
      timeout: cdk.Duration.seconds(30),
    });
    this.lambdaAuthorizer = authorizerHandlerFunction;

    const suppressions = [
      {
        id: 'AwsSolutions-COG2',
        reason: 'TOTP MFA is optional so invited users can sign in without an authenticator app; admins are encouraged to enroll.',
      },
    ];
    if (!isPlus) {
      suppressions.push({
        id: 'AwsSolutions-COG3',
        reason: 'Threat protection requires the Cognito PLUS feature plan; ESSENTIALS is the cost-conscious default. Deploy with -c cognitoFeaturePlan=PLUS to enable it.',
      });
      suppressions.push({
        id: 'AwsSolutions-COG8',
        reason: 'ESSENTIALS is the cost-conscious default feature plan; deploy with -c cognitoFeaturePlan=PLUS for threat protection.',
      });
    }
    NagSuppressions.addResourceSuppressions(userPool, suppressions);
  }
}
