import { callRpc, errorResponse, handleOptions, json, requireRole } from '../../_lib/supabase.mjs';

export async function onRequest(context) {
    const options = handleOptions(context.request);
    if (options) return options;

    try {
        if (context.request.method === 'GET') {
            await requireRole(context, ['seller', 'admin']);
            return json(context.request, await callRpc(context, 'seller_list_advertisements'));
        }
        if (context.request.method === 'POST') {
            await requireRole(context, ['customer', 'seller', 'admin']);
            const body = await context.request.json();
            return json(context.request, await callRpc(context, 'seller_submit_advertisement', {
                p_product_id: body.productId,
                p_payment_reference: body.paymentReference
            }), 201);
        }
        return json(context.request, { error: 'Method not allowed' }, 405);
    } catch (error) {
        return errorResponse(context.request, error);
    }
}