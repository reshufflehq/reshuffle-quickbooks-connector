const dotenv = require('dotenv')
dotenv.config()
import { Reshuffle, BaseHttpConnector, EventConfiguration } from 'reshuffle-base-connector'
import { Request, Response } from 'express'
import cron from 'node-cron'
const OAuthClient = require('intuit-oauth')
var crypto = require("crypto");

const QuickBooks = require('node-quickbooks')
const TOKEN_KEY_PREFIX = 'quickbooks/token/'
const DEFAULT_OAUTH_CALLBACK_PATH = '/callbacks/quickbooks'
const DEFAULT_WEBHOOK_PATH = '/webhooks/quickbooks'

export interface QuickbooksConnectorConfigOptions {
  realmId: string
  consumerKey: string
  consumerSecret: string
  sandbox?: boolean
  debug?: boolean
  callback?: string 
  webhookPath?: string
  baseUrl: string
  webhooksVerifier: string
}

export interface QuickBookTokenWrapper {
  realmID?: string
  token?: any,
  access_expire_timestamp?: any
  refresh_expire_timestamp?: any
}

export interface QuickbooksConnectorEventOptions {
  action: QBAction
}

export interface QBEvent {
  realmId: string
  name: string
  id: string
  operation: string
  lastUpdated: string
  action: string
}

export default class QuickbooksConnector extends BaseHttpConnector<
  QuickbooksConnectorConfigOptions,
  QuickbooksConnectorEventOptions
  > {

  private client: any
  private readonly oauthClient: any
  private readonly options: QuickbooksConnectorConfigOptions
  private webhookPath = ''

  // TODO validate paths, trim strings
  constructor(app: Reshuffle, options: QuickbooksConnectorConfigOptions, id?: string) {
    super(app, options, id)
    options.sandbox = options.sandbox || (process.env.NODE_ENV != 'production')
    options.debug = options.debug || false
    options.callback = options.callback || DEFAULT_OAUTH_CALLBACK_PATH
    this.options = options
    this.oauthClient = this.createClientAuthURL(options.sandbox)
    this.app.registerHTTPDelegate(options.callback || DEFAULT_OAUTH_CALLBACK_PATH, this)
  }

  onStart(): void {
    if (Object.keys(this.eventConfigurations).length) {
      this.webhookPath = this.options.webhookPath || DEFAULT_WEBHOOK_PATH
      this.app.registerHTTPDelegate(this.webhookPath, this)
      this.loopRefresh()
    }
  }

  // Your events
  on(
    options: QuickbooksConnectorEventOptions,
    handler: any,
    eventId: string,
  ): EventConfiguration {
    if (!eventId) {
      eventId = `Quickbooks/${options.action}/${this.id}`
    }
    const event = new EventConfiguration(eventId, this, options)
    this.eventConfigurations[event.id] = event

    this.app.when(event, handler)
    return event
  }

  // Your actions
  // Actions will have to call getValidClient() in order to validate and refresh token if needed.
  sdk() {
    return this.client
  }

  // Store functions
  async getQBToken(): Promise<any> {
    const dbToken = await this.app.getPersistentStore().get(this.getTokenKey())
    return new Promise((resolve) => {
      resolve(dbToken)
    })
  }

  async storeQBToken(wrapper: QuickBookTokenWrapper): Promise<any> {
    let newToken = {
      realmID: this.options.realmId,
      token: wrapper.token,
      access_expire_timestamp: wrapper.access_expire_timestamp,
      refresh_expire_timestamp: wrapper.refresh_expire_timestamp
    }
    const dbToken = await this.app.getPersistentStore().set(this.getTokenKey(), newToken)
    return new Promise((resolve) => {
      resolve(dbToken)
    })
  }

  getTokenKey() {
    return `${TOKEN_KEY_PREFIX}${this.options.realmId || 'default'}`
  }


  async loopRefresh() {
    this.refreshTokenIfNeeded()
    // check every 30 seconds
    const task = cron.schedule('*/30 * * * * *', () => {
      this.refreshTokenIfNeeded()
    })
    task.start()
  }

  // Token and Client
  createClientAuthURL(sandbox: boolean) {
    let inStore = false
    this.isInStore().then((value) => { inStore = value })
    if (inStore) return

    // TODO: Save this so we can match on return..
    const state = crypto.randomBytes(20).toString('hex')
    const oauthClient = new OAuthClient({
      clientId: this.options.consumerKey,
      clientSecret: this.options.consumerSecret,
      environment: sandbox ? 'sandbox' : 'production',
      redirectUri: this.options.baseUrl + this.options.callback,
    })
    const authUri = oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state,
    }) // can be an array of multiple scopes ex : {scope:[OAuthClient.scopes.Accounting,OAuthClient.scopes.OpenId]

    console.log(`===================== authUri =====================\n
    ${authUri}
    \n===================================================`)
    return oauthClient
  }

  async isInStore() {
    const dbToken = await this.getQBToken()
    if (dbToken) {
      await this.setClient(dbToken.token)
      return true
    }
    return false
  }

  async refreshTokenIfNeeded() {
    let dbToken = await this.getQBToken()
    if (!dbToken) {
      console.error(`refreshTokenIfNeeded, stored token not found for ${this.options.realmId}`)
      return
    }
    // this.oauthClient.setToken(dbToken.token)
    const expiry = Number(dbToken.token.createdAt) + Number(dbToken.token.expires_in) * 1000
    const needRefresh = (expiry - 120 * 1000) < Date.now() // 2 minutes before token is expired

    if (needRefresh) {
      console.log('Before refreshing', dbToken.token)
      try {
        this.oauthClient.setToken(dbToken.token)
        const authResponse = await this.oauthClient.refresh()
        await this.storeTokenAndSetClient(authResponse)
        console.log('Token is refreshed')
      }
      catch (e: any) {
        console.error('Refresh Token Error:', e)
        console.error(e.intuit_tid)
      }
    }
    return this.client
  }

  // Use to exchange code for token
  async handle(req: Request, res: Response): Promise<boolean> {
    if (req.route.path === this.webhookPath) {
      this.handleWebhook(req, res)
    } else if (req.query.realmId) { // oauth callback
      try {
        const authResponse = await this.oauthClient.createToken(req.url)
        await this.storeTokenAndSetClient(authResponse)
      }
      catch (e: any) {
        console.error('The error message is :',e)
        console.error(e.intuit_tid)
      }
      /* Do we need this
      const { state, realmId, code } = req.query
      if (typeof realmId === "string") {
        this.options.realmId = realmId
      }*/
    } else {
      res.send({ 'text': 'Error' })
    }
    res.sendStatus(200)
    return true
  }

  private async handleWebhook(req: Request, res: Response) {
    var webhookPayload = JSON.stringify(req.body)
    var signature = req.get('intuit-signature')

    // if signature is empty return 401
    if (!signature) {
      return res.sendStatus(401)
    }
    // if payload is empty, don't do anything
    if (!webhookPayload) {
      return res.sendStatus(200)
    }
    // Validates the payload with the intuit-signature hash
    var hash = crypto.createHmac('sha256', this.options.webhooksVerifier).update(webhookPayload).digest('base64')
    if (signature !== hash) {
      return res.sendStatus(401)
    }

    for (var i = 0; i < req.body.eventNotifications.length; i++) {
      var entities = req.body.eventNotifications[i].dataChangeEvent.entities
      var realmID = req.body.eventNotifications[i].realmId
      for (var j = 0; j < entities.length; j++) {
        const ev: QBEvent = {
          'realmId': realmID,
          'name': entities[i].name,
          'id': entities[i].id,
          'operation': entities[i].operation,
          'lastUpdated': entities[i].lastUpdated,
          'action': `${entities[i].name}/${entities[i].operation}`
        }
        console.log("notification :" + JSON.stringify(ev))

        for (const ec of Object.values(this.eventConfigurations)) {
          const storeAction = ec.options.action
          const incoming = ev.action
          if (storeAction == incoming) {
            await this.app.handleEvent(ec.id, ev)
            return
          }
        }
      }
    }
    return res.sendStatus(200)
  } 

  async storeTokenAndSetClient(authResponse: any) {
    const newToken = authResponse.getJson()
    newToken.createdAt = Date.now() // createdAt is not retrieved when creating/refreshing token    
    await this.storeQBToken({
      realmID: this.options.realmId,
      token: newToken,
    })
    await this.setClient(newToken)
  }

  async setClient(token: any) {
    this.client = new QuickBooks(
      this.options.consumerKey,
      this.options.consumerSecret,
      token.access_token,
      false,                // no token secret for oAuth 2.0
      this.options.realmId,
      this.options.sandbox, // use the sandbox?
      false,                // enable debugging?
      null,                 // set minorversion, or null for the latest version
      '2.0',                //oAuth version
      token.refresh_token)
  }
}

export type QBAction =
  | 'Account/Delete'
  | 'Account/Merge'
  | 'Account/Create'
  | 'Account/Update'
  | 'Bill/Delete'
  | 'Bill/Create'
  | 'Bill/Update'
  | 'BillPayment/Delete'
  | 'BillPayment/Void'
  | 'BillPayment/Create'
  | 'BillPayment/Update'
  | 'Budget/Create'
  | 'Budget/Update'
  | 'Class/Delete'
  | 'Class/Merge'
  | 'Class/Create'
  | 'Class/Update'
  | 'CreditMemo/Delete'
  | 'CreditMemo/Emailed'
  | 'CreditMemo/Void'
  | 'CreditMemo/Create'
  | 'CreditMemo/Update'
  | 'Currency/Create'
  | 'Currency/Update'
  | 'Customer/Delete'
  | 'Customer/Merge'
  | 'Customer/Create'
  | 'Customer/Update'
  | 'Department/Merge'
  | 'Department/Create'
  | 'Department/Update'
  | 'Deposit/Delete'
  | 'Deposit/Create'
  | 'Deposit/Update'
  | 'Employee/Delete'
  | 'Employee/Merge'
  | 'Employee/Create'
  | 'Employee/Update'
  | 'Estimate/Delete'
  | 'Estimate/Emailed'
  | 'Estimate/Create'
  | 'Estimate/Update'
  | 'Invoice/Delete'
  | 'Invoice/Emailed'
  | 'Invoice/Void'
  | 'Invoice/Create'
  | 'Invoice/Update'
  | 'Item/Delete'
  | 'Item/Merge'
  | 'Item/Create'
  | 'Item/Update'
  | 'JournalCode/Create'
  | 'JournalCode/Update'
  | 'JournalEntry/Delete'
  | 'JournalEntry/Create'
  | 'JournalEntry/Update'
  | 'Payment/Delete'
  | 'Payment/Emailed'
  | 'Payment/Void'
  | 'Payment/Create'
  | 'Payment/Update'
  | 'PaymentMethod/Merge'
  | 'PaymentMethod/Create'
  | 'PaymentMethod/Update'
  | 'Preferences/Update'
  | 'Purchase/Delete'
  | 'Purchase/Void'
  | 'Purchase/Create'
  | 'Purchase/Update'
  | 'PurchaseOrder/Delete'
  | 'PurchaseOrder/Emailed'
  | 'PurchaseOrder/Create'
  | 'PurchaseOrder/Update'
  | 'RefundReceipt/Delete'
  | 'RefundReceipt/Emailed'
  | 'RefundReceipt/Void'
  | 'RefundReceipt/Create'
  | 'RefundReceipt/Update'
  | 'SalesReceipt/Delete'
  | 'SalesReceipt/Emailed'
  | 'SalesReceipt/Void'
  | 'SalesReceipt/Create'
  | 'SalesReceipt/Update'
  | 'TaxAgency/Create'
  | 'TaxAgency/Update'
  | 'Term/Create'
  | 'Term/Update'
  | 'TimeActivity/Delete'
  | 'TimeActivity/Create'
  | 'TimeActivity/Update'
  | 'Transfer/Delete'
  | 'Transfer/Void'
  | 'Transfer/Create'
  | 'Transfer/Update'
  | 'Vendor/Delete'
  | 'Vendor/Merge'
  | 'Vendor/Create'
  | 'Vendor/Update'
  | 'VendorCredit/Delete'
  | 'VendorCredit/Create'
  | 'VendorCredit/Update'

export { QuickbooksConnector }