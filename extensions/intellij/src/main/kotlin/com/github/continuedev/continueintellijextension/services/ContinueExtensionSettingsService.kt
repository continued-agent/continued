package com.github.continuedev.continueintellijextension.services

import com.github.continuedev.continueintellijextension.constants.getConfigJsonPath
import com.github.continuedev.continueintellijextension.constants.getConfigJsPath
import com.google.gson.Gson
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.DumbAware
import com.intellij.ui.components.JBPasswordField
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.util.io.HttpRequests
import com.intellij.util.messages.Topic
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.io.File
import java.net.URL
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.swing.*

class ContinueSettingsComponent : DumbAware {
    val panel: JPanel = JPanel(GridBagLayout())
    val remoteConfigServerUrl: JTextField = JTextField()
    val remoteConfigSyncPeriod: JTextField = JTextField()
    val userToken: JBPasswordField = JBPasswordField()
    val enableTabAutocomplete: JCheckBox = JCheckBox("Enable Tab Autocomplete")
    val displayEditorTooltip: JCheckBox = JCheckBox("Display Editor Tooltip")
    val showIDECompletionSideBySide: JCheckBox = JCheckBox("Show IDE completions side-by-side")

    init {
        val constraints = GridBagConstraints()

        constraints.fill = GridBagConstraints.HORIZONTAL
        constraints.weightx = 1.0
        constraints.weighty = 0.0
        constraints.gridx = 0
        constraints.gridy = GridBagConstraints.RELATIVE

        panel.add(JLabel("Remote Config Server URL:"), constraints)
        constraints.gridy++
        constraints.gridy++
        panel.add(remoteConfigServerUrl, constraints)
        constraints.gridy++
        panel.add(JLabel("Remote Config Sync Period (in minutes):"), constraints)
        constraints.gridy++
        panel.add(remoteConfigSyncPeriod, constraints)
        constraints.gridy++
        panel.add(JLabel("User Token:"), constraints)
        constraints.gridy++
        panel.add(userToken, constraints)
        constraints.gridy++
        panel.add(enableTabAutocomplete, constraints)
        constraints.gridy++
        panel.add(displayEditorTooltip, constraints)
        constraints.gridy++
        panel.add(showIDECompletionSideBySide, constraints)
        constraints.gridy++

        // Add a "filler" component that takes up all remaining vertical space
        constraints.weighty = 1.0
        val filler = JPanel()
        panel.add(filler, constraints)
    }
}

data class ContinueRemoteConfigSyncResponse(
    var configJson: String?,
    var configJs: String?
)

@State(
    name = "com.github.continuedev.continueintellijextension.services.ContinueExtensionSettings",
    storages = [Storage("ContinueExtensionSettings.xml")]
)
open class ContinueExtensionSettings : PersistentStateComponent<ContinueExtensionSettings.ContinueState> {

    class ContinueState {
        var lastSelectedInlineEditModel: String? = null
        var shownWelcomeDialog: Boolean = false
        var remoteConfigServerUrl: String? = null
        var remoteConfigSyncPeriod: Int = 60
        var enableTabAutocomplete: Boolean = true
        var displayEditorTooltip: Boolean = true
        var showIDECompletionSideBySide: Boolean = false
        var continueTestEnvironment: String = "production"
    }

    companion object {
        private val log = Logger.getInstance(ContinueExtensionSettings::class.java)

        // The user token is a secret: it must never be persisted in the
        // settings XML (which is part of the IDE profile and can leak via
        // backups/screenshots). Store it in the IDE Credential Store instead.
        private val TOKEN_CREDENTIAL_ATTRIBUTES = CredentialAttributes(
            "ContinueExtensionSettings.userToken",
            "continue-user-token",
            this::class.java,
            false
        )

        val instance: ContinueExtensionSettings
            get() = service<ContinueExtensionSettings>()

        fun getTokenFromCredentialStore(): String? {
            return try {
                PasswordSafe.instance.getPassword(TOKEN_CREDENTIAL_ATTRIBUTES)
            } catch (e: Exception) {
                log.warn("Failed to read user token from credential store", e)
                null
            }
        }

        fun saveTokenToCredentialStore(token: String) {
            try {
                PasswordSafe.instance.setPassword(
                    TOKEN_CREDENTIAL_ATTRIBUTES,
                    token
                )
            } catch (e: Exception) {
                log.warn("Failed to save user token to credential store", e)
            }
        }

        fun clearTokenFromCredentialStore() {
            try {
                PasswordSafe.instance.setPassword(
                    TOKEN_CREDENTIAL_ATTRIBUTES,
                    null
                )
            } catch (e: Exception) {
                log.warn("Failed to clear user token from credential store", e)
            }
        }

        /**
         * Remote config servers are fetched and their response is written to
         * disk and imported as executable JavaScript. Only HTTPS is allowed so
         * the bearer token cannot be sniffed and the response cannot be
         * tampered with on the wire. HTTP is only accepted for loopback
         * addresses, which is the explicit local-development case.
         */
        fun validateRemoteConfigServerUrl(rawUrl: String): String? {
            val url = try {
                URL(rawUrl)
            } catch (e: Exception) {
                return "Remote config server URL is not a valid URL: $rawUrl"
            }
            val host = url.host.lowercase()
            val isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
            if (url.protocol != "https" && !(url.protocol == "http" && isLoopback)) {
                return "Remote config server URL must use HTTPS (HTTP is only allowed for localhost/127.0.0.1). Got: ${url.protocol}://${url.host}"
            }
            return null
        }
    }

    var continueState: ContinueState = ContinueState()

    private var remoteSyncFuture: ScheduledFuture<*>? = null

    override fun getState(): ContinueState {
        return continueState
    }

    override fun loadState(state: ContinueState) {
        continueState = state
        // Migration: the token used to live in the XML state. If a value is
        // still present, move it into the credential store and clear it from
        // the XML so it is no longer persisted in the IDE profile.
        // (ContinueState no longer declares userToken; read the legacy field
        // reflectively so old XML can still be migrated.)
        try {
            val legacyField = ContinueState::class.java.getDeclaredField("userToken")
            legacyField.isAccessible = true
            val legacyToken = legacyField.get(state) as? String
            if (!legacyToken.isNullOrEmpty()) {
                saveTokenToCredentialStore(legacyToken)
                legacyField.set(state, null)
            }
        } catch (e: Exception) {
            // No legacy field present; nothing to migrate.
        }
    }

    private fun syncRemoteConfig() {
        val remoteServerUrl = state.remoteConfigServerUrl
        if (remoteServerUrl.isNullOrEmpty()) return

        val validationError = validateRemoteConfigServerUrl(remoteServerUrl)
        if (validationError != null) {
            log.warn("Skipping remote config sync: $validationError")
            return
        }

        val token = getTokenFromCredentialStore()
        val baseUrl = remoteServerUrl.removeSuffix("/")
        try {
            val url = "$baseUrl/sync"
            val responseBody = HttpRequests.request(url)
                .connectTimeout(5000)
                .readTimeout(5000)
                .tuner { connection ->
                    if (token != null)
                        connection.addRequestProperty("Authorization", "Bearer $token")
                }.readString()
            val response = Gson().fromJson(responseBody, ContinueRemoteConfigSyncResponse::class.java)
            val hostname = URL(url).host

            if (!response.configJson.isNullOrEmpty()) {
                File(getConfigJsonPath(hostname)).writeText(response.configJson!!)
            }

            if (!response.configJs.isNullOrEmpty()) {
                File(getConfigJsPath(hostname)).writeText(response.configJs!!)
            }
        } catch (e: Exception) {
            log.warn("Failed to sync remote config from $baseUrl", e)
        }
    }

    fun addRemoteSyncJob() {
        remoteSyncFuture?.cancel(false)
        remoteSyncFuture = null

        val remoteServerUrl = continueState.remoteConfigServerUrl
        if (remoteServerUrl.isNullOrEmpty()) return

        val validationError = validateRemoteConfigServerUrl(remoteServerUrl)
        if (validationError != null) {
            log.warn("Not scheduling remote config sync: $validationError")
            return
        }

        remoteSyncFuture = AppExecutorUtil.getAppScheduledExecutorService()
            .scheduleWithFixedDelay(
                ::syncRemoteConfig,
                0,
                continueState.remoteConfigSyncPeriod.toLong(),
                TimeUnit.MINUTES
            )
    }
}

interface SettingsListener {
    fun settingsUpdated(settings: ContinueExtensionSettings.ContinueState)

    companion object {
        val TOPIC = Topic.create("SettingsUpdate", SettingsListener::class.java)
    }
}

class ContinueExtensionConfigurable : Configurable {
    private var mySettingsComponent: ContinueSettingsComponent? = null

    override fun createComponent(): JComponent {
        mySettingsComponent = ContinueSettingsComponent()
        return mySettingsComponent!!.panel
    }

    override fun isModified(): Boolean {
        val settings = ContinueExtensionSettings.instance
        val currentToken = ContinueExtensionSettings.getTokenFromCredentialStore() ?: ""
        val modified =
            mySettingsComponent?.remoteConfigServerUrl?.text != settings.continueState.remoteConfigServerUrl ||
                    mySettingsComponent?.remoteConfigSyncPeriod?.text?.toIntOrNull() != settings.continueState.remoteConfigSyncPeriod ||
                    String(mySettingsComponent?.userToken?.password ?: CharArray(0)) != currentToken ||
                    mySettingsComponent?.enableTabAutocomplete?.isSelected != settings.continueState.enableTabAutocomplete ||
                    mySettingsComponent?.displayEditorTooltip?.isSelected != settings.continueState.displayEditorTooltip ||
                    mySettingsComponent?.showIDECompletionSideBySide?.isSelected != settings.continueState.showIDECompletionSideBySide
        return modified
    }

    override fun apply() {
        val settings = ContinueExtensionSettings.instance
        val newUrl = mySettingsComponent?.remoteConfigServerUrl?.text
        val validationError = ContinueExtensionSettings.validateRemoteConfigServerUrl(newUrl.orEmpty())
        if (validationError != null) {
            // Surface the validation error to the user without relying on the
            // component's error property (not available on all platform versions).
            val errorLabel = mySettingsComponent?.panel?.components
                ?.filterIsInstance<JLabel>()
                ?.firstOrNull { it.text == "Remote Config Server URL:" }
            errorLabel?.text = "Remote Config Server URL: ($validationError)"
            return
        }
        settings.continueState.remoteConfigServerUrl = newUrl
        settings.continueState.remoteConfigSyncPeriod = mySettingsComponent?.remoteConfigSyncPeriod?.text?.toIntOrNull() ?: 60
        val newToken = String(mySettingsComponent?.userToken?.password ?: CharArray(0))
        if (newToken.isNotEmpty()) {
            ContinueExtensionSettings.saveTokenToCredentialStore(newToken)
        } else if (ContinueExtensionSettings.getTokenFromCredentialStore() != null) {
            // Empty field means "clear the token"
            ContinueExtensionSettings.clearTokenFromCredentialStore()
        }
        settings.continueState.enableTabAutocomplete = mySettingsComponent?.enableTabAutocomplete?.isSelected ?: false
        settings.continueState.displayEditorTooltip = mySettingsComponent?.displayEditorTooltip?.isSelected ?: true
        settings.continueState.showIDECompletionSideBySide =
            mySettingsComponent?.showIDECompletionSideBySide?.isSelected ?: false

        ApplicationManager.getApplication().messageBus.syncPublisher(SettingsListener.TOPIC)
            .settingsUpdated(settings.continueState)
        ContinueExtensionSettings.instance.addRemoteSyncJob()
    }

    override fun reset() {
        val settings = ContinueExtensionSettings.instance
        mySettingsComponent?.remoteConfigServerUrl?.text = settings.continueState.remoteConfigServerUrl
        mySettingsComponent?.remoteConfigSyncPeriod?.text = settings.continueState.remoteConfigSyncPeriod.toString()
        mySettingsComponent?.userToken?.text = (ContinueExtensionSettings.getTokenFromCredentialStore() ?: "")
        mySettingsComponent?.enableTabAutocomplete?.isSelected = settings.continueState.enableTabAutocomplete
        mySettingsComponent?.displayEditorTooltip?.isSelected = settings.continueState.displayEditorTooltip
        mySettingsComponent?.showIDECompletionSideBySide?.isSelected =
            settings.continueState.showIDECompletionSideBySide
    }

    override fun disposeUIResources() {
        mySettingsComponent = null
    }

    override fun getDisplayName(): String =
        "Continue Extension Settings"
}
