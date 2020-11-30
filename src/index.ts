const dotenv = require('dotenv')
dotenv.config()
import { Reshuffle, BaseHttpConnector, EventConfiguration } from 'reshuffle-base-connector'
import { Request, Response } from 'express'
const OAuthClient = require('intuit-oauth')
var crypto = require("crypto");

//const QuickBooks = require('node-quickbooks')

const TOKEN_KEY_PREFIX = 'quickbooks/token/'

export interface QuickbooksConnectorConfigOptions {
  realmId: Number
  consumerKey: string
  consumerSecret: string
  oauthToken: string
  refreshToken: string
  sandbox?: boolean
  debug?: boolean
  callback: string
}

export interface QuickBookTokenWrapper {
  realmID?: Number
  token?: any
  access_expire_timestamp?: any
  refresh_expire_timestamp?: any
}

export interface QuickbooksConnectorEventOptions {
  option1?: string
  // ...
}

export default class QuickbooksConnector extends BaseHttpConnector<
  QuickbooksConnectorConfigOptions,
  QuickbooksConnectorEventOptions
> {

  private readonly client: any
  private readonly oauthClient: any
  private readonly options: QuickbooksConnectorConfigOptions

  constructor(app: Reshuffle, options: QuickbooksConnectorConfigOptions, id?: string) {
    super(app, options, id)
    options.sandbox = options.sandbox || (process.env.NODE_ENV!='production')
    options.debug = options.debug || false
    //this.client = new QuickBooks(options, options.realmId)
    this.options = options
    this.oauthClient = this.createClientAuthURL(false)
    this.app.registerHTTPDelegate('/callbacks/quickbooks', this)
  }

  onStart(): void {
    // If you need to do something specific on start, otherwise remove this function
  }

  onStop(): void {
    // If you need to do something specific on stop, otherwise remove this function
  }

  // Your events
  on(
    options: QuickbooksConnectorEventOptions,
    handler: any,
    eventId: string,
  ): EventConfiguration {
    if (!eventId) {
      eventId = `Quickbooks/${options.option1}/${this.id}`
    }
    const event = new EventConfiguration(eventId, this, options)
    this.eventConfigurations[event.id] = event

    this.app.when(event, handler)

    return event
  }

  // Your actions
  sdk(): any {
   return this.client
  }


  // Store functions
  async getQBToken(token: QuickBookTokenWrapper): Promise<any> {
    const dbToken = await this.app.getPersistentStore().get(`${TOKEN_KEY_PREFIX}${token.realmID||'default'}`)
    return new Promise((resolve) => {
      resolve(dbToken)
    })
  }

  async storeQBToken(wrapper: QuickBookTokenWrapper): Promise<any> {
    let newToken = {
      realmID: wrapper.realmID,
      access_token: wrapper.token.access_token,
      refresh_token: wrapper.token.refresh_token,
      access_expire_timestamp: wrapper.access_expire_timestamp,
      refresh_expire_timestamp: wrapper.refresh_expire_timestamp
    }
    const dbToken = await this.app.getPersistentStore().set(
      `${TOKEN_KEY_PREFIX}${wrapper.token.realmID||'default'}`, newToken
    )
    return new Promise((resolve) => {
      resolve(dbToken)
    })
  }

  // Connection
  createClientAuthURL(sandbox: boolean) {

    // TODO: Save this so we can match on return..
    const state = crypto.randomBytes(20).toString('hex');
    const oauthClient = new OAuthClient({
      clientId: this.options.consumerKey,
      clientSecret: this.options.consumerSecret,
      environment: sandbox ? 'sandbox' : 'production',
      redirectUri: this.options.callback,
    });
    const authUri = oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state,
    }); // can be an array of multiple scopes ex : {scope:[OAuthClient.scopes.Accounting,OAuthClient.scopes.OpenId]

    console.log(authUri)
    return oauthClient
  }

  // Use to exchange code for token
  async handle(req: Request, res: Response): Promise<boolean> {
    console.log(req.query.code)
    if (req.query.realmId) {
      this.oauthClient.createToken(req.url)
        .then(function(authResponse:any) {
          console.log('The Token is  '+ JSON.stringify(authResponse.getJson()));
        })
        .catch(function(e:any) {
          console.error("The error message is :"+e.originalMessage);
          console.error(e.intuit_tid);
        });
        const {state, realmId, code} = req.query
        if (typeof realmId === "string") {
          this.options.realmId = parseInt(realmId, 10)
        }
    } else {
      res.send({'text':'Error'})
    }
    res.sendStatus(200)
    return true
  }
}

export { QuickbooksConnector }
