(function () {
    async function resolveAdminAccess(supabase) {
        if (!supabase?.auth?.getSession || !supabase.auth.getUser || !supabase.rpc) {
            throw new Error('The administrator access client is unavailable.');
        }

        const { data: { session } = {}, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session?.user) return { status: 'signed_out', user: null };

        const { data: { user } = {}, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user) return { status: 'signed_out', user: null };

        const { data: role, error: roleError } = await supabase.rpc('current_profile_role');
        if (roleError) throw roleError;

        return {
            status: role === 'admin' ? 'admin' : 'denied',
            user
        };
    }

    async function canManageAdminRoles(supabase) {
        if (!supabase?.rpc) throw new Error('The administrator access client is unavailable.');
        const { data, error } = await supabase.rpc('admin_role_management_status');
        if (error) throw error;
        return data === true;
    }

    window.AdminWorkspaceAccess = {
        resolve: resolveAdminAccess,
        canManageAdminRoles
    };
})();
