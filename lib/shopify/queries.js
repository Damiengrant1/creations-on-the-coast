export const WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_PAID", "ORDERS_UPDATED", "ORDERS_CANCELLED"];
export const LIST_WEBHOOKS = `query DashboardOrderWebhooks($uri: String!, $after: String) {
  webhookSubscriptions(first: 100, after: $after, uri: $uri) {
    nodes { id topic uri }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const CREATE_WEBHOOK = `mutation DashboardCreateOrderWebhook($topic: WebhookSubscriptionTopic!, $input: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $input) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;
// Original totals minus ALL discount allocations preserve order-level discounts.
export const RECOVER_ORDERS = `query DashboardRecoverOrders($query: String!, $after: String) {
  orders(first: 5, after: $after, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt processedAt sourceName test cancelledAt
      displayFinancialStatus displayFulfillmentStatus paymentGatewayNames taxesIncluded
      email phone note customAttributes { key value }
      shippingAddress { name company address1 address2 city province zip country }
      totalPriceSet { shopMoney { amount currencyCode } }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      currentShippingPriceSet { shopMoney { amount currencyCode } }
      totalTaxSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      totalOutstandingSet { shopMoney { amount currencyCode } }
      lineItems(first: 100) {
        pageInfo { hasNextPage }
        nodes {
          id name title variantTitle quantity currentQuantity
          variant { id }
          originalTotalSet { shopMoney { amount currencyCode } }
          discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
          customAttributes { key value }
        }
      }
    }
  }
}`;
