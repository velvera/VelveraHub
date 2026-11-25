# Listing and institution copy audit

## Scope and result

Reviewed the public storefront and listing flows across the root, Nigeria, UK,
shop-owner, and admin site trees. Promotional copy now presents VelveraHub as a
general marketplace for products and services. No public page identifies a
seller as a student, calls a product a student listing, or describes a
student-only shop or seller flow.

Institutions remain available as optional location context. Selecting one does
not describe the buyer, seller, or listing audience. The location search,
institution directory, state filters, and nearby-area fields remain functional.

## Copy inventory

| Site tree | Reviewed areas | Current copy and behavior |
| --- | --- | --- |
| Root | Homepage, catalogue, product details, sell, account, and listings | General marketplace wording; institution is an optional location; seller and listing labels are generic. |
| Nigeria | Homepage, catalogue, product details, sell, account, and listings | Same general marketplace hierarchy with Nigerian locations and prices; no student-only listing flow. |
| UK | Homepage, catalogue, product details, sell, account, and listings | Same general marketplace hierarchy with UK locations and prices; no student-only listing flow. |
| Shop owner | Shop workspace and listing tools | Generic product and service listings; shop ownership remains a seller workflow, not a listing category. |
| Admin | Admin workspace and media settings | Generic listing language and one shared media limit for every listing. |

## Text retained, revised, and removed

- **Retained:** institution search and optional institution selection on listings
  and location controls. The selector is presented as a location tool.
- **Revised:** “School / institution” and campus-area labels now describe an
  optional institution location and nearby area. Generic sell and account copy
  no longer implies student eligibility or affiliation.
- **Removed from public product details:** listing-type specifications,
  “Independent seller” identity labels, the marketplace-seller fallback,
  “Private conversation” eyebrow, and the “View more products” wording.
- **Removed from seller account creation:** the separate business-institution
  field, which could be mistaken for seller affiliation. Business location
  remains; listing location can still use an institution.

## Functional coverage kept

Seller sign-in, account creation, product and service submission, image and
video uploads, moderation, account pages, saved items, seller workspaces, and
the institution/location search remain in place. Shop-specific ownership and
verification checks continue to apply where needed for shop payments; they do
not classify a listing as a different product type.

## Existing database compatibility

No data migration was run. Existing listing records and legacy columns are
preserved; current browser and server listing flows no longer read or write a
listing-type value. Legacy policy names are referenced only by database
`DROP POLICY` statements so reapplying the security SQL removes obsolete
student-specific permissions rather than leaving them active.
