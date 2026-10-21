import 'server-only'
import { client } from './sanity.client'
import { getCoupons, getShippingMethods } from './sanity.queries'
import { getGiftCardByCode } from './gift-cards'
 
const MAX_ITEMS = 100
const MAX_QTY_PER_ITEM = 100
 
export interface ClientCartItem {
  id?: string
  quantity?: number
}
 
export interface PricedItem {
  id: string
  name: string
  slug?: string
  unitPrice: number
  quantity: number
  lineTotal: number
}
 
export type OrderPricing =
  | {
      ok: true
      items: PricedItem[]
      subtotal: number
      couponDiscount: number
      shippingCost: number
      giftCardApplied: number
      total: number
    }
  | { ok: false; error: string }
 
interface SanityProductPricing {
  _id: string
  name: string
  slug?: string
  price: number
  isDiscount?: boolean
  discountedPrice?: number
}
 

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
 

function unitPriceOf(p: SanityProductPricing): number {
  if (p.isDiscount === true && p.discountedPrice != null && p.discountedPrice < p.price) {
    return p.discountedPrice
  }
  return p.price
}
 
export async function computeOrderPricing(input: {
  items?: ClientCartItem[]
  couponCode?: string
  shippingMethod?: string
  giftCardCode?: string
}): Promise<OrderPricing> {
  const { items, couponCode, shippingMethod, giftCardCode } = input
 
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { ok: false, error: 'Cart items are required' }
  }
  if (items.length > MAX_ITEMS) {
    return { ok: false, error: 'Too many items in cart' }
  }
 
  const ids = [...new Set(items.map((i) => i.id).filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) {
    return { ok: false, error: 'Invalid cart items' }
  }
 
  const products = await client.fetch<SanityProductPricing[]>(
    `*[_type == "product" && _id in $ids]{
      _id, name, "slug": slug.current, price, isDiscount, discountedPrice
    }`,
    { ids },
  )
  const byId = new Map(products.map((p) => [p._id, p]))
 
  const priced: PricedItem[] = []
  let subtotal = 0
  for (const item of items) {
    const product = item.id ? byId.get(item.id) : undefined
    if (!product) {
      return { ok: false, error: 'One or more items are no longer available' }
    }
 
    const quantity = Math.floor(Number(item.quantity ?? 1))
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      return { ok: false, error: 'Invalid item quantity' }
    }
 
    const unitPrice = unitPriceOf(product)
    const lineTotal = round2(unitPrice * quantity)
    priced.push({
      id: product._id,
      name: product.name,
      slug: product.slug,
      unitPrice,
      quantity,
      lineTotal,
    })
    subtotal = round2(subtotal + lineTotal)
  }
 
  let couponDiscount = 0
  if (couponCode?.trim()) {
    const coupons = await getCoupons()
    const coupon = coupons.find((c) => c.code === couponCode.trim().toUpperCase())
    if (coupon && (coupon.minSubtotal == null || subtotal >= coupon.minSubtotal)) {
      couponDiscount =
        coupon.type === 'percentage'
          ? round2(subtotal * (coupon.value / 100))
          : round2(Math.min(coupon.value, subtotal))
    }
  }

  couponDiscount = round2(Math.min(couponDiscount, subtotal))
 
  let shippingCost = 0
  if (shippingMethod) {
    const methods = await getShippingMethods()
    const method = methods.find((m) => m.id === shippingMethod)
    if (method) {
      shippingCost = round2(method.cost)
    }
  }
 
  let giftCardApplied = 0
  if (giftCardCode?.trim()) {
    const card = await getGiftCardByCode(giftCardCode)
    const notExpired = card ? new Date(card.expiresAt).getTime() > Date.now() : false
    if (card && card.status === 'active' && notExpired) {
      const dueBeforeGiftCard = round2(Math.max(0, subtotal - couponDiscount + shippingCost))
      giftCardApplied = round2(Math.min(card.currentBalance, dueBeforeGiftCard))
    }
  }
 
  const total = round2(Math.max(0, subtotal - couponDiscount + shippingCost - giftCardApplied))
 
  return { ok: true, items: priced, subtotal, couponDiscount, shippingCost, giftCardApplied, total }
}
 