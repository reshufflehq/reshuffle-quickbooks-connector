# reshuffle-quickbooks-connector

[Code](https://github.com/reshufflehq/reshuffle-quickbooks-connector) |
[npm](https://www.npmjs.com/package/reshuffle-quickbooks-connector) |
[Code sample](https://github.com/reshufflehq/reshuffle-quickbooks-connector/examples)

`npm install reshuffle-quickbooks-connector`

### Reshuffle Quickbooks Connector

This package contains a [Reshuffle](https://github.com/reshufflehq/reshuffle)
connector to connect [QuickBooks Online app APIs](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/account).
This connector requires to define a [Reshuffle Datastore](https://dev.reshuffle.com/docs/persistency) in order to maintain the Quickbooks access and refresh tokens, the Datastore can be in memory, file or Database. The connector takes care of refreshing the access token.

The following example exposes an endpoint to return the data of Bill after an Update action, the access and refresh tokens are stored in reshuffle DB and will be managed internally by the Reshuffle engine.

```js
const { Reshuffle, SQLStoreAdapter } = require('reshuffle')
const { QuickbooksConnector } = require('reshuffle-quickbooks-connector')

const app = new Reshuffle()

const pool = new Pool({user: 'RESHUFFLE_DB_USER',
  host: 'RESHUFFLE_DB_HOST',
  database: 'RESHUFFLE_DB',
  password: 'RESHUFFLE_DB_PASS',
  port: RESHUFFLE_DB_PORT})
  const persistentStore = new SQLStoreAdapter(pool, 'reshuffledb')
  app.setPersistentStore(persistentStore)

const quickbooksConnector = new QuickbooksConnector(app, {
  realmId: 'REALM_ID',
  consumerKey: 'CONSUMER_KEY',
  consumerSecret: 'CONSUMER_SECRET',
  sandbox: true,
  debug: true,
  baseUrl: 'BASE_RUNTIME_URL',
  webhooksVerifier: 'WEBHOOK_VERIFIER'
})

quickbooksConnector.on({ type: 'Bill/Update' }, async (event, app) => {
  console.log('Bill/Update event ')
  console.log(event.id)
  console.log(event.name)
  console.log(event.operation)
})

app.start()
```

### Table of Contents

[Configuration Options](#configuration)

#### Connector Events

[Listening to Monday events](#listen)

#### Connector Actions

[SDK](#sdk) - Retrieve a full Monday sdk object


### <a name="configuration"></a> Configuration options

```js
const app = new Reshuffle()
const quickbooksConnector = new QuickbooksConnector(app, {
  realmId: 'YOUR_REALM_ID',
  consumerKey: 'CONSUMER_KEY',
  consumerSecret: 'CONSUMER_SECRET',
  sandbox: false, // Working environment, Sandbox or Production. Default false. Can be set in process.env.NODE_ENV
  debug: false, // Default false
  callback: 'CALLBACK_PATH', // Default '/callbacks/quickbooks', The path component of one of the redirect URIs listed for this project in the Quickbooks developer dashboard.
  webhookPath: 'WEBHOOK_PATH', // Default '/webhooks/quickbooks', The path component of the Webhook Endpoint URI for this project in the developer dashboard
  baseUrl: 'BASE_RUNTIME_URL',
  webhooksVerifier: 'WEBHOOK_VERIFIER' // Webhook Verifier Token for this project in the developer dashboard
})
```

`sandbox`, `debug`, `callback` and `webhookPath` are optional.

More details about the fields are described in [node-quickbooks](https://www.npmjs.com/package/node-quickbooks)

You can use the `webhookPath` to configure the url that Quickbooks hits when it makes its calls to.
For example - providing if `baseURL=https://my-reshuffle.com` and `webhookPath='/webhook` will result in a complete webhook path of `https://my-reshuffle.com/webhook`.
If you do not provide a `webhookPath`, Reshuffle will use the default webhook path for the connector which is `/webhooks/quickbooks`.
You will need to register this webhook with Quickbooks. See [instructions](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks).

You can use the `callback` to configure the redirect URI that your app serves to users upon authentication.
For example - providing if `baseURL=https://my-reshuffle.com` and `callback='/callback` will result in a complete webhook path of `https://my-reshuffle.com/callback`.
If you do not provide a `callback`, Reshuffle will use the default callback path for the connector which is `/callbacks/quickbooks`.
You will need to register this callback with Quickbooks. See more details about [authentication](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0).

### <a name="events"></a> Events

#### <a name="listen"></a> Listening to Quickbooks events

To listen to events happening in Quickbooks, you'll need to capture them with the connector's `on`
function, providing a `QuickbooksConnectorEventOptions` to it.


```typescript
interface QuickbooksConnectorEventOptions {
  type: QBEventType // See bellow 
}

// Where...
type QBEventType =
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
```

Events require that an integration webhook is configured in Quickbooks. 

The connector triggers events of the following type:

```typescript
interface QBEvent {
  realmId: string
  name: string // Entity type name e.g. Customer, Account, Bill
  id: string   // Entity ID
  operation: string 
  lastUpdated: string
  action: string
}
```

_Example:_

```typescript
quickbooksConnector.on({ type: 'Bill/Update' }, async (event, app) => {
  console.log('Bill/Update event ')
  console.log(event.id)
  console.log(event.name)
  console.log(event.operation)
})
```

The description of fields and events can be found [here](hhttps://developer.intuit.com/app/developer/qbo/docs/develop/webhooks/entities-and-operations-supported)

### <a name="actions"></a> Actions

#### <a name="sdk"></a> sdk

Returns an object providing full access to the Quickbooks APIs

```typescript
const sdk = await connector.sdk()
```

_Example:_

```typescript
const sdk = await quickbooksConnector.sdk()
sdk.getCompanyInfo('YOUR_REALM_ID', function(err, result) {
  console.log('Result: ', JSON.stringify(result))
}
```