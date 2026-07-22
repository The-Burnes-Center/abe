import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { cognitoDomainName } from '../constants'
import { UserPool, UserPoolIdentityProviderOidc,UserPoolClient, UserPoolClientIdentityProvider, ProviderAttribute } from 'aws-cdk-lib/aws-cognito';
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as fs from 'fs';
import * as path from 'path';
import { MANAGED_LOGIN_BRANDING_SETTINGS } from './managed-login-branding';
import { brand } from '../../config/brand';

// The Cognito Managed Login screen (used only by SSO deployments; native
// deployments render the in-app login page instead) shows the brand logo so
// users see the brand of the agency that owns the tool at sign-in.
const LOGIN_LOGO_PATH = path.join(
  __dirname,
  '../user-interface/app/public',
  brand.assets.logo,
);
// Cognito wants the asset type spelled out and only accepts these formats.
const LOGIN_LOGO_EXTENSION = ((): string => {
  const byExt: Record<string, string> = {
    '.png': 'PNG',
    '.svg': 'SVG',
    '.jpg': 'JPEG',
    '.jpeg': 'JPEG',
    '.webp': 'WEBP',
    '.ico': 'ICO',
  };
  return byExt[path.extname(LOGIN_LOGO_PATH).toLowerCase()] ?? 'PNG';
})();

/**
 * Cognito validates branding SVGs against a strict allowlist and rejects the
 * cruft design tools export (deploy fails with e.g. `element
 * [svg#version|xmlns:xlink|xml:space] is not allowed`). Reduce the SVG to
 * what Cognito accepts: no XML declaration or comments, fills inlined from
 * simple `<style>` class rules, and a root element carrying only
 * xmlns + viewBox.
 */
function sanitizeSvgForCognito(svg: string): string {
  let out = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Inline `.name { fill: ...; }` rules from <style> blocks, then drop them.
  const fills = new Map<string, string>();
  const styleBlock = out.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (styleBlock) {
    for (const rule of styleBlock[1].matchAll(/\.([\w-]+)\s*\{\s*fill:\s*([^;}]+);?\s*\}/g)) {
      fills.set(rule[1], rule[2].trim());
    }
    out = out.replace(styleBlock[0], '');
  }
  out = out.replace(/class="([\w-]+)"/g, (match, name: string) => {
    const fill = fills.get(name);
    return fill ? `fill="${fill}"` : match;
  });

  const viewBox = out.match(/viewBox="([^"]+)"/)?.[1];
  return out
    .replace(
      /<svg[^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg"${viewBox ? ` viewBox="${viewBox}"` : ''}>`,
    )
    .trim();
}

const LOGIN_LOGO_BASE64 = (
  LOGIN_LOGO_EXTENSION === 'SVG'
    ? Buffer.from(sanitizeSvgForCognito(fs.readFileSync(LOGIN_LOGO_PATH, 'utf8')))
    : fs.readFileSync(LOGIN_LOGO_PATH)
).toString('base64');

export interface AuthorizationStackProps {
  /**
   * Sign-in / sign-out callback URLs for the app client. Lazy-resolved at synth to
   * the site URL (custom domain when bound, else the CloudFront domain) so they
   * always match the redirect URLs the frontend writes into aws-exports.json.
   */
  readonly callbackUrls: string[];
  /**
   * Name of the (console-managed) OIDC identity provider to enable on the app
   * client, e.g. "MassGov-Login". Supplied per-deployment via context/env — never
   * hardcoded — so each environment enables its own SSO provider, or none (in which
   * case only the built-in COGNITO provider is enabled). Must name a provider that
   * already exists in the pool, or the deploy will fail.
   */
  readonly oidcProviderName?: string;
}

export class AuthorizationStack extends Construct {
  public readonly lambdaAuthorizer : lambda.Function;
  public readonly userPool : UserPool;
  public readonly userPoolClient : UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthorizationStackProps) {
    super(scope, id);

    // Replace these values with your Azure client ID, client secret, and issuer URL
    // const azureClientId = 'your-azure-client-id';
    // const azureClientSecret = 'your-azure-client-secret';
    // const azureIssuerUrl = 'https://your-azure-issuer.com';

    // Create the Cognito User Pool
    const userPool = new UserPool(this, 'UserPool', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      selfSignUpEnabled: true,
      mfa: cognito.Mfa.OPTIONAL,
      featurePlan: cognito.FeaturePlan.PLUS,
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      autoVerify: { email: true, phone: true },
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      customAttributes: {
        'role': new cognito.StringAttribute({ minLen: 0, maxLen: 30, mutable: true }),
      },
    });
    this.userPool = userPool;

    // Create a provider attribute for mapping Azure claims
    // const providerAttribute = new ProviderAttribute({
    //   name: 'custom_attr',
    //   type: 'String',
    // });
    userPool.addDomain('CognitoDomain', {
      cognitoDomain: {
        domainPrefix: cognitoDomainName,
      },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    
    
    // Add the Azure OIDC identity provider to the User Pool
    // const azureProvider = new UserPoolIdentityProviderOidc(this, 'AzureProvider', {
    //   clientId: azureClientId,
    //   clientSecret: azureClientSecret,
    //   issuerUrl: azureIssuerUrl,
    //   userPool: userPool,
    //   attributeMapping: {
    //     // email: ProviderAttribute.fromString('email'),
    //     // fullname: ProviderAttribute.fromString('name'),
    //     // custom: {
    //     //   customKey: providerAttribute,
    //     // },
    //   },
    //   // ... other optional properties
    // });

    // The app client's full OAuth/IdP configuration is declared here so it lives in
    // source control and a deploy can no longer silently reset it (the L2 emits every
    // field, so anything left unset reverts to a CDK/Cognito default on deploy).
    //
    // Security: the OAuth scopes intentionally EXCLUDE `aws.cognito.signin.user.admin`,
    // so no hosted-UI token can call Cognito self-service APIs (UpdateUserAttributes)
    // to self-assign `custom:role: ["Admin"]`.
    //
    // The auth flows and attribute permissions depend on the deployment mode:
    //
    //  - SSO deployments (oidcProviderName set): USER_SRP stays DISABLED because a
    //    native-flow access token always carries the self-service scope, and the IdP
    //    mapping (roles -> custom:role) requires the client to keep write access to
    //    `custom:role`. Users sign in via the Cognito Managed Login page.
    //
    //  - Native deployments (no SSO provider): the app renders its own login page,
    //    which needs USER_SRP enabled. To keep self-escalation impossible, the
    //    client's write attributes explicitly EXCLUDE `custom:role`, so an
    //    UpdateUserAttributes call with a user's own token is rejected. Admin roles
    //    are assigned only by an operator (console / AdminUpdateUserAttributes,
    //    which bypasses client write permissions).
    const supportedIdentityProviders = [UserPoolClientIdentityProvider.COGNITO];
    if (props.oidcProviderName) {
      supportedIdentityProviders.push(
        UserPoolClientIdentityProvider.custom(props.oidcProviderName),
      );
    }
    const nativeSignIn = !props.oidcProviderName;

    const userPoolClient = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      authFlows: nativeSignIn
        ? { userSrp: true, custom: true } // in-app login page (SRP; password never leaves the browser)
        : { custom: true }, // -> ALLOW_CUSTOM_AUTH + ALLOW_REFRESH_TOKEN_AUTH (no password / SRP)
      // Only meaningful for native sign-in: return generic errors so the login page
      // can't be used to probe which emails have accounts.
      preventUserExistenceErrors: nativeSignIn ? true : undefined,
      // Native mode: everything the UI/tokens need is readable (including custom:role
      // for admin gating), but custom:role is NOT writable by the client. SSO mode
      // leaves both at the Cognito default (ALL) so IdP mapping can write custom:role.
      readAttributes: nativeSignIn
        ? new cognito.ClientAttributes()
            .withStandardAttributes({
              email: true,
              emailVerified: true,
              fullname: true,
              phoneNumber: true,
              phoneNumberVerified: true,
            })
            .withCustomAttributes('role')
        : undefined,
      writeAttributes: nativeSignIn
        ? new cognito.ClientAttributes().withStandardAttributes({
            email: true,
            fullname: true,
            phoneNumber: true,
          })
        : undefined,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.PHONE,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.callbackUrls,
      },
      supportedIdentityProviders,
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      refreshTokenValidity: cdk.Duration.days(30),
      authSessionValidity: cdk.Duration.minutes(3),
      enableTokenRevocation: true,
    });

    // The L2 always serialises refresh-token validity in minutes (30 days -> 43200).
    // Pin it back to days on the L1 child so the synthesized template matches the live
    // client byte-for-byte and no needless diff is produced (43200 minutes == 30 days).
    const cfnUserPoolClient = userPoolClient.node.defaultChild as cognito.CfnUserPoolClient;
    cfnUserPoolClient.refreshTokenValidity = 30;
    cfnUserPoolClient.tokenValidityUnits = {
      accessToken: 'minutes',
      idToken: 'minutes',
      refreshToken: 'days',
    };

    this.userPoolClient = userPoolClient;

    new cognito.CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: false,
      returnMergedResources: false,
      settings: MANAGED_LOGIN_BRANDING_SETTINGS,
      assets: [
        {
          bytes: LOGIN_LOGO_BASE64,
          category: 'FORM_LOGO',
          colorMode: 'LIGHT',
          extension: LOGIN_LOGO_EXTENSION,
        },
      ],
    });

    const authorizerHandlerFunction = new lambda.Function(this, 'AuthorizationFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'websocket-api-authorizer')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "USER_POOL_ID" : userPool.userPoolId,
        "APP_CLIENT_ID" : userPoolClient.userPoolClientId
      },
      timeout: cdk.Duration.seconds(30)
    });

    this.lambdaAuthorizer = authorizerHandlerFunction;
    
    new cdk.CfnOutput(this, "UserPool ID", {
      value: userPool.userPoolId || "",
    });

    new cdk.CfnOutput(this, "UserPool Client ID", {
      value: userPoolClient.userPoolClientId || "",
    });

    // new cdk.CfnOutput(this, "UserPool Client Name", {
    //   value: userPoolClient.userPoolClientName || "",
    // });


    
  }
}
