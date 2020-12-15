import dotenv from 'dotenv'
dotenv.config()
import { Reshuffle, BaseHttpConnector, EventConfiguration } from 'reshuffle-base-connector'
import { Request, Response } from 'express'
import cron from 'node-cron'
import OAuthClient from 'intuit-oauth'
import crypto from 'crypto'
import QuickBooks from 'node-quickbooks'

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
  token?: any
  access_expire_timestamp?: any
  refresh_expire_timestamp?: any
}

export interface QuickbooksConnectorEventOptions {
  type: QBEventType
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
  private webhookPath = ''
  private _timeout?: NodeJS.Timeout
  // Check if refreshTokenWhenNeeded() was not already invoked from onStart() or handle()
  private refreshIsRunning = false

  // TODO validate paths, trim strings
  constructor(app: Reshuffle, options: QuickbooksConnectorConfigOptions, id?: string) {
    super(app, options, id)
    this.configOptions.sandbox = options.sandbox || process.env.NODE_ENV != 'production'
    this.configOptions.debug = options.debug || false
    this.configOptions.callback = options.callback || DEFAULT_OAUTH_CALLBACK_PATH
    this.oauthClient = this.createClientAuthURL(this.configOptions.sandbox)
    this.app.registerHTTPDelegate(options.callback || DEFAULT_OAUTH_CALLBACK_PATH, this)
  }

  onStart(): void {
    if (Object.keys(this.eventConfigurations).length) {
      this.webhookPath = this.configOptions.webhookPath || DEFAULT_WEBHOOK_PATH
      this.app.registerHTTPDelegate(this.webhookPath, this)
    }
    if (!this.refreshIsRunning) {
      this.refreshIsRunning = true
      this.refreshTokenWhenNeeded()
    }
  }

  // Events
  on(options: QuickbooksConnectorEventOptions, handler: any, eventId: string): EventConfiguration {
    if (!eventId) {
      eventId = `Quickbooks/${options.type}/${this.id}`
    }
    const event = new EventConfiguration(eventId, this, options)
    this.eventConfigurations[event.id] = event

    this.app.when(event, handler)
    return event
  }

  // Actions
  // Actions will have to call isInStore() in order to set the client.
  async sdk() {
    await this.isInStore()
    return this.client
  }

  // Store functions
  private async getQBToken(): Promise<any> {
    const dbToken = await this.app.getPersistentStore().get(this.getTokenKey())
    return dbToken
  }

  private async storeQBToken(wrapper: QuickBookTokenWrapper): Promise<any> {
    return await this.app.getPersistentStore().set(this.getTokenKey(), wrapper)
  }

  private getTokenKey() {
    return `${TOKEN_KEY_PREFIX}${this.configOptions.realmId || 'default'}`
  }

  // Token and Client
  private createClientAuthURL(sandbox: boolean) {
    const state = crypto.randomBytes(20).toString('hex')
    const oauthClient = new OAuthClient({
      clientId: this.configOptions.consumerKey,
      clientSecret: this.configOptions.consumerSecret,
      environment: sandbox ? 'sandbox' : 'production',
      redirectUri: this.configOptions.baseUrl + this.configOptions.callback,
    })
    const authUri = oauthClient.authorizeUri({
      scope: [OAuthClient.scopes.Accounting, OAuthClient.scopes.OpenId],
      state,
    })

    console.log('==========================================================')
    console.log('== Click the Auth URI below to authorize the connection ==')
    console.log('======================== authUri =========================\n')
    console.log(authUri)
    console.log('\n==========================================================')
    return oauthClient
  }

  private async isInStore() {
    const dbToken = await this.getQBToken()
    if (dbToken) {
      this.setClient(dbToken.token)
      return true
    }
    return false
  }

  private async refreshTokenWhenNeeded() {
    const dbToken = await this.getQBToken()
    if (!dbToken) {
      this.refreshIsRunning = false
      return
    }

    const expiry = this.timeToRefreshToken(dbToken)

    this._timeout = setTimeout(async () => {
      await this.refreshToken(dbToken.token)
      this.refreshTokenWhenNeeded()
    }, expiry)
  }

  /**
   * expiry = createdAt + expires_in - now() - 2 minutes
   * if expiry is negative - return 0 for imidiate refresh
   */
  private timeToRefreshToken(dbToken: any) {
    let expiry = Number(dbToken.token.createdAt) + Number(dbToken.token.expires_in) * 1000
    expiry = expiry - Date.now() - 120 * 1000
    expiry = expiry > 0 ? expiry : 0
    return expiry
  }

  private async refreshToken(token: any) {
    console.log('Before refreshing')
    try {
      this.oauthClient.setToken(token)
      const authResponse = await this.oauthClient.refresh()
      await this.storeTokenAndSetClient(authResponse)
      console.log('Token is refreshed')
    } catch (e: any) {
      console.error('Refresh Token Error:', e)
      console.error(e.intuit_tid)
      return false
    }
    return true
  }

  // Use to exchange code for token
  async handle(req: Request, res: Response): Promise<boolean> {
    if (req.route.path === this.webhookPath) {
      await this.handleWebhook(req, res)
    } else if (req.query.realmId) {
      // oauth callback
      try {
        const authResponse = await this.oauthClient.createToken(req.url)
        await this.storeTokenAndSetClient(authResponse)
        if (!this.refreshIsRunning) {
          this.refreshIsRunning = true
          this.refreshTokenWhenNeeded()
        }
      } catch (e: any) {
        console.error('The error message is :', e)
        console.error(e.intuit_tid)
      }
    } else {
      res.send({ text: 'Error' })
    }
    res.sendStatus(200)
    return true
  }

  private async handleWebhook(req: Request, res: Response) {
    const webhookPayload = JSON.stringify(req.body)
    const signature = req.get('intuit-signature')

    // if signature is empty return 401
    if (!signature) {
      return res.sendStatus(401)
    }
    // if payload is empty, don't do anything
    if (!webhookPayload) {
      return res.sendStatus(200)
    }
    // Validates the payload with the intuit-signature hash
    const hash = crypto
      .createHmac('sha256', this.configOptions.webhooksVerifier)
      .update(webhookPayload)
      .digest('base64')
    if (signature !== hash) {
      return res.sendStatus(401)
    }

    for (const eventNotification of req.body.eventNotifications) {
      const {
        realmId,
        dataChangeEvent: { entities },
      } = eventNotification
      for (const entity of entities) {
        entity.action = `${entity.name}/${entity.operation}`
        const eventsToExecute = Object.values(this.eventConfigurations).filter(
          (e) => e.options.type === entity.action,
        )
        for (const event of eventsToExecute) {
          await this.app.handleEvent(event.id, entity)
        }
      }
    }
    return
  }

  private async storeTokenAndSetClient(authResponse: any) {
    const newToken = authResponse.getJson()
    newToken.createdAt = Date.now() // createdAt is not retrieved when creating/refreshing token
    await this.storeQBToken({
      realmID: this.configOptions.realmId,
      token: newToken,
    })
    this.setClient(newToken)
  }

  onStop() {
    this._timeout && clearInterval(this._timeout)
  }

  private setClient(token: any) {
    this.client = new QuickBooks(
      this.configOptions.consumerKey,
      this.configOptions.consumerSecret,
      token.access_token,
      false, // no token secret for oAuth 2.0
      this.configOptions.realmId,
      this.configOptions.sandbox, // use the sandbox?
      false, // enable debugging?
      null, // set minorversion, or null for the latest version
      '2.0', //oAuth version
      token.refresh_token,
    )
  }
}

export type QBEventType =
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
