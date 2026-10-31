import {defineField, defineType} from 'sanity'

export const productType = defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Product Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: {
        source: 'name',
        maxLength: 96,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'price',
      title: 'Price',
      type: 'number',
      description: 'Regular price. When "Add Discount" is on, this is shown struck-through.',
      validation: (Rule) => Rule.required().positive(),
    }),
    defineField({
      name: 'isDiscount',
      title: 'Add Discount',
      type: 'boolean',
      description: 'Toggle on to put this product on sale',
      initialValue: false,
    }),
    defineField({
      name: 'discountedPrice',
      title: 'Discounted Price',
      type: 'number',
      description: 'The sale price the customer pays. Must be lower than Price.',
      hidden: ({parent}) => !parent?.isDiscount,
      validation: (Rule) =>
        Rule.custom((discountedPrice, context) => {
          const parent = context.parent as {isDiscount?: boolean; price?: number} | undefined
          if (!parent?.isDiscount) return true
          if (discountedPrice == null) return 'Discounted Price is required when Add Discount is on'
          if (discountedPrice <= 0) return 'Discounted Price must be positive'
          if (parent.price != null && discountedPrice >= parent.price) {
            return 'Discounted Price must be less than the regular Price'
          }
          return true
        }),
    }),
    defineField({
      name: 'shortDescription',
      title: 'Short Description',
      type: 'string',
      description: 'Brief description for product cards',
      //validation: (Rule) => Rule.required().max(200),
      validation: (Rule) => Rule.max(200)
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'text',
      description: 'Full product description for detail page',
      rows: 5,
      //validation: (Rule) => Rule.required(),
      //validation: (Rule) => Rule.optional()
    }),
    defineField({
      name: 'image',
      title: 'Product Image',
      type: 'image',
      options: {
        hotspot: true,
      },
      fields: [
        {
          name: 'alt',
          type: 'string',
          title: 'Alternative Text',
          description: 'Important for SEO and accessibility',
        },
      ],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'reference',
      to: [{type: 'category'}],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [{type: 'string'}],
      options: {
        layout: 'tags',
      },
      description: 'E.g., "bestseller", "organic", "new", etc.',
    }),
    defineField({
      name: 'inStock',
      title: 'In Stock',
      type: 'boolean',
      description: 'Is this product currently available?',
      initialValue: true,
    }),
    defineField({
      name: 'featured',
      title: 'Featured Product',
      type: 'boolean',
      description: 'Show on homepage and featured sections',
      initialValue: false,
    }),
  ],
  preview: {
    select: {
      title: 'name',
      media: 'image',
      subtitle: 'category.name',
      price: 'price',
    },
    prepare(selection) {
      const {title, media, subtitle, price} = selection
      return {
        title,
        subtitle: subtitle ? `${subtitle} - $${price}` : `$${price}`,
        media,
      }
    },
  },
})
