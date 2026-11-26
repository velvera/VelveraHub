-- Keep new delivery markets disabled until an administrator configures and
-- enables their rates. Only untouched seed rows are changed; values saved via
-- admin_save_delivery_settings have updated_by set and are preserved.
BEGIN;

ALTER TABLE public.delivery_platform_settings
    ALTER COLUMN is_enabled SET DEFAULT FALSE;

UPDATE public.delivery_platform_settings
   SET is_enabled = FALSE,
       updated_at = now()
 WHERE updated_by IS NULL
   AND is_enabled IS TRUE
   AND platform_commission_percent = 0
   AND fixed_delivery_fee = 0
   AND (
       (country_code = 'NG' AND currency_code = 'NGN' AND currency_per_usd = 900)
       OR
       (country_code = 'GB' AND currency_code = 'GBP' AND currency_per_usd = 0.79)
   );

COMMIT;
