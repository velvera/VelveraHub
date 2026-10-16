-- Apply after database/schema.sql. This migration is safe to rerun.
-- Delivery choices are seller-provided claims; buyers must confirm actual
-- fees, coverage, and timing with the seller before payment.

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS delivery_options JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'products_delivery_options_shape'
          AND conrelid = 'public.products'::regclass
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT products_delivery_options_shape
            CHECK (
                jsonb_typeof(delivery_options) = 'object'
                AND (
                    NOT (delivery_options ? 'pickup')
                    OR jsonb_typeof(delivery_options->'pickup') = 'boolean'
                )
                AND (
                    NOT (delivery_options ? 'local_delivery')
                    OR jsonb_typeof(delivery_options->'local_delivery') = 'boolean'
                )
                AND (
                    NOT (delivery_options ? 'regional_delivery')
                    OR jsonb_typeof(delivery_options->'regional_delivery') = 'boolean'
                )
                AND (
                    NOT (delivery_options ? 'notes')
                    OR (
                        jsonb_typeof(delivery_options->'notes') = 'string'
                        AND length(delivery_options->>'notes') <= 300
                    )
                )
            );
    END IF;
    END;
$$;

COMMIT;
