export const SAMPLE_ANDROID_STRINGS_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Application branding (translatable=false) -->
    <string name="app_name" translatable="false">OmniTask</string>

    <!-- General user interface actions -->
    <string name="quick_action_watched">Watched</string>
    <string name="action_save">Save Changes</string>
    <string name="action_cancel">Cancel</string>
    <string name="action_delete">Delete Item</string>
    <string name="action_retry">Retry Connection</string>

    <!-- Onboarding and Welcome messages -->
    <!-- Displayed on first launch after user logs in -->
    <string name="welcome_headline">Welcome to OmniTask!</string>
    <string name="welcome_description">Don\'t worry about losing your progress. Everything is saved automatically and works 100% offline.</string>
    <string name="user_greeting">Hello, %1$s! You have %2$d pending tasks for today.</string>

    <!-- Task details and statuses -->
    <string name="task_created_success">Task &quot;%s&quot; has been created successfully.</string>
    <string name="task_due_date">Due on %1$s at %2$s</string>
    <string name="no_tasks_placeholder">No active tasks found. Tap the <b>+</b> button below to add your first task!</string>
    <string name="storage_usage_notice">Local database is using %1$.1f MB of %2$.1f MB allocated storage.</string>

    <!-- Compliance and legal agreements -->
    <!-- Shown in registration and account settings -->
    <string name="terms_and_privacy_notice">By clicking continue, you agree to our <b>Terms of Service</b> &amp; <i>Privacy Policy</i>.</string>

    <!-- Quantity-based messages -->
    <plurals name="unread_notifications_count">
        <item quantity="one">You have %d unread notification</item>
        <item quantity="other">You have %d unread notifications</item>
    </plurals>

    <plurals name="selected_files_count">
        <item quantity="one">%d file selected</item>
        <item quantity="other">%d files selected</item>
    </plurals>

    <!-- Task priority filters -->
    <string-array name="priority_levels">
        <item>Urgent</item>
        <item>High Priority</item>
        <item>Normal</item>
        <item>Low Priority</item>
    </string-array>
</resources>`;

export const SAMPLE_TARGET_SPANISH_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="quick_action_watched">Visto</string>
    <string name="action_save">Guardar Cambios</string>
    <string name="action_cancel">Cancelar</string>
    <string name="action_delete">Eliminar Elemento</string>
    <string name="welcome_headline">¡Bienvenido a OmniTask!</string>
    <string name="welcome_description">No te preocupes por perder tu progreso. Todo se guarda automáticamente y funciona 100% sin conexión.</string>
    <string name="user_greeting">¡Hola, %1$s! Tienes %2$d tareas pendientes para hoy.</string>
</resources>`;

export const SAMPLE_TARGET_ARABIC_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="action_save">حفظ التغييرات</string>
    <string name="action_cancel">إلغاء</string>
    <string name="action_delete">حذف العنصر</string>
    <string name="welcome_headline">مرحبًا بك في OmniTask!</string>
    <string name="welcome_description">لا تقلق بشأن فقدان تقدمك. كل شيء يُحفظ تلقائيًا ويعمل دون اتصال بالإنترنت.</string>
    <plurals name="unread_notifications_count">
        <item quantity="zero">ليس لديك أي إشعارات غير مقروءة</item>
        <item quantity="one">لديك إشعار واحد (%d) غير مقروء</item>
        <item quantity="two">لديك إشعاران (%d) غير مقروءين</item>
        <item quantity="few">لديك %d إشعارات غير مقروءة</item>
        <item quantity="many">لديك %d إشعارًا غير مقروء</item>
        <item quantity="other">لديك %d إشعار غير مقروء</item>
    </plurals>
</resources>`;
