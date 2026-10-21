import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createPendingOrder } from '@/lib/orders'
import { computeOrderPricing } from '@/lib/pricing'

type CheckoutItem = {
  id?: string
  name?: string
  title?: string
  slug?: string
  image?: string
  price?: number
  quantity?: number
}

type CheckoutAddress = {
  firstName?: string
  lastName?: string
  address?: string
  addressLine2?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

type CreateStripePaymentIntentBody = {
  items?: CheckoutItem[]
  subtotal?: number
  couponCode?: string
  couponDiscount?: number
  shippingMethod?: string
  shippingCost?: number
  shippingAddress?: CheckoutAddress
  billingAddress?: CheckoutAddress
  billingSameAsShipping?: boolean
  totalAmount?: number | string
  email?: string
  firstName?: string
  lastName?: string
  phone?: string
  giftCardCode?: string
  giftCardAppliedAmount?: number
  paymentIntentId?: string
}

export async function GET() {
  return NextResponse.json({
    message: 'Stripe payment intent endpoint is available. Use POST to create a payment intent.',
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { Allow: 'GET,POST,OPTIONS' } })
}

export async function POST(request: Request) {
  try {
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
      return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 500 })
    }

    const stripe = new Stripe(stripeSecretKey)
    const body = (await request.json()) as CreateStripePaymentIntentBody
    const {
      items,
      couponCode,
      shippingMethod,
      shippingAddress,
      billingAddress,
      billingSameAsShipping,
      email,
      firstName,
      lastName,
      phone,
      giftCardCode,
      paymentIntentId: existingPaymentIntentId,
    } = body

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Cart items are required' }, { status: 400 })
    }

    const pricing = await computeOrderPricing({ items, couponCode, shippingMethod, giftCardCode })
    if (!pricing.ok) {
      return NextResponse.json({ error: pricing.error }, { status: 400 })
    }

    const amountInCents = Math.round(pricing.total * 100)

    const truncate = (s: string, max = 500) =>
      s.length <= max ? s : s.slice(0, max - 1) + '…'
    const itemsSummary = truncate(
      items
        .map((i) => `${Number(i.quantity ?? 1)}× ${i.name ?? i.title ?? 'item'}`)
        .join(', '),
      480,
    )
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

    const metadata: Record<string, string> = {
      order_type: 'storefront',
      customer_email: email || '',
      customer_name: fullName,
      items_count: String(items.length),
      items_summary: itemsSummary,
      subtotal: pricing.subtotal.toFixed(2),
      shipping_method: shippingMethod || 'standard',
      shipping_cost: pricing.shippingCost.toFixed(2),
      ship_name:
        `${shippingAddress?.firstName ?? firstName ?? ''} ${shippingAddress?.lastName ?? lastName ?? ''}`.trim(),
      ship_line1: shippingAddress?.address ?? '',
      ship_line2: shippingAddress?.addressLine2 ?? '',
      ship_city: shippingAddress?.city ?? '',
      ship_state: shippingAddress?.state ?? '',
      ship_postal: shippingAddress?.zipCode ?? '',
      ship_country: shippingAddress?.country ?? '',
      ...(phone && { customer_phone: phone }),
      ...(couponCode && {
        coupon_code: couponCode,
        coupon_discount: pricing.couponDiscount.toFixed(2),
      }),
      ...(giftCardCode && { gift_card_code: giftCardCode }),
      ...(pricing.giftCardApplied > 0 && {
        gift_card_applied_amount: pricing.giftCardApplied.toFixed(2),
      }),
    }

    const shipping = shippingAddress
      ? {
          name: `${shippingAddress.firstName || ''} ${shippingAddress.lastName || ''}`.trim(),
          phone: phone || undefined,
          address: {
            line1: shippingAddress.address || '',
            line2: shippingAddress.addressLine2 || undefined,
            city: shippingAddress.city || '',
            state: shippingAddress.state || '',
            postal_code: shippingAddress.zipCode || '',
            country: shippingAddress.country || 'US',
          },
        }
      : undefined

    let paymentIntent: Stripe.PaymentIntent | null = null
    if (existingPaymentIntentId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(existingPaymentIntentId)
        if (existing.status === 'requires_payment_method') {
          paymentIntent = await stripe.paymentIntents.update(existing.id, {
            amount: amountInCents,
            receipt_email: email,
            metadata,
            ...(shipping ? { shipping } : {}),
          })
        }
      } catch (reuseErr) {
        console.error('Could not reuse PaymentIntent, creating a new one', reuseErr)
      }
    }

    if (!paymentIntent) {
      paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        receipt_email: email,
        metadata,
        shipping,
      })
    }

    let orderNumber: string | undefined
    try {
      const imageById = new Map(items.map((item) => [item.id, item.image]))
      const orderItems = pricing.items.map((item) => ({
        productId: item.id,
        name: item.name,
        slug: item.slug,
        image: imageById.get(item.id),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      }))

      const computedSubtotal = pricing.subtotal

      const order = await createPendingOrder({
        stripePaymentIntentId: paymentIntent.id,
        customer: {
          email: email ?? '',
          firstName,
          lastName,
          phone,
        },
        shippingAddress: shippingAddress
          ? {
              line1: shippingAddress.address,
              line2: shippingAddress.addressLine2,
              city: shippingAddress.city,
              state: shippingAddress.state,
              postalCode: shippingAddress.zipCode,
              country: shippingAddress.country,
            }
          : {},
        billingAddress: billingAddress
          ? {
              line1: billingAddress.address,
              line2: billingAddress.addressLine2,
              city: billingAddress.city,
              state: billingAddress.state,
              postalCode: billingAddress.zipCode,
              country: billingAddress.country,
            }
          : {},
        billingSameAsShipping: billingSameAsShipping ?? false,
        items: orderItems,
        subtotal: computedSubtotal,
        couponCode,
        couponDiscount: pricing.couponDiscount || undefined,
        shippingMethod: shippingMethod ?? 'standard',
        shippingCost: pricing.shippingCost,
        giftCardCode,
        giftCardApplied: pricing.giftCardApplied || undefined,
        total: pricing.total,
      })
      orderNumber = order.orderNumber

      try {
        await stripe.paymentIntents.update(paymentIntent.id, {
          metadata: { ...metadata, order_number: orderNumber },
        })
      } catch (updateErr) {
        console.error('Failed to update Stripe metadata with order_number', updateErr)
      }
    } catch (err) {
      console.error('Sanity order creation failed for PaymentIntent', paymentIntent.id, err)
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      orderNumber,
    })
  } catch (error) {
    console.error('Payment Intent creation error:', error)
    const details = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to create payment intent', details },
      { status: 500 },
    )
  }
}