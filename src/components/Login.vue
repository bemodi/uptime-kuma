<template>
    <div class="form-container">
        <div class="form">
            <div v-if="!showPasswordForm" class="pt-3">
                <button class="w-100 btn btn-primary" type="button" :disabled="processing" @click="passkeyLogin">
                    <font-awesome-icon icon="key" class="me-1" />
                    {{ $t("Log in with passkey") }}
                </button>

                <button class="btn btn-link mt-3" type="button" @click="showPasswordForm = true">
                    {{ $t("usePasswordLogin") }}
                </button>

                <div v-if="res && !res.ok" class="alert alert-danger mt-3" role="alert">
                    {{ $t(res.msg) }}
                </div>
            </div>

            <form v-else aria-label="Login Form" class="pt-3" @submit.prevent="submit">
                <p class="small text-muted">{{ $t("passwordLoginHint") }}</p>

                <div v-if="!tokenRequired" class="form-floating">
                    <input
                        id="floatingInput"
                        v-model="username"
                        type="text"
                        class="form-control"
                        placeholder="Username"
                        autocomplete="username"
                        required
                    />
                    <label for="floatingInput">{{ $t("Username") }}</label>
                </div>

                <div v-if="!tokenRequired" class="mt-3">
                    <HiddenInput
                        id="floatingPassword"
                        v-model="password"
                        :placeholder="$t('Password')"
                        autocomplete="current-password"
                        :required="true"
                    />
                </div>

                <div v-if="tokenRequired">
                    <div class="form-floating mt-3">
                        <input
                            id="otp"
                            ref="otpInput"
                            v-model="token"
                            type="text"
                            maxlength="6"
                            class="form-control"
                            placeholder="123456"
                            autocomplete="one-time-code"
                            required
                        />
                        <label for="otp">{{ $t("Token") }}</label>
                    </div>
                </div>

                <div class="form-check mb-3 mt-3 d-flex justify-content-center pe-4">
                    <div class="form-check">
                        <input
                            id="remember"
                            v-model="$root.remember"
                            type="checkbox"
                            value="remember-me"
                            class="form-check-input"
                        />

                        <label class="form-check-label" for="remember">
                            {{ $t("Remember me") }}
                        </label>
                    </div>
                </div>
                <button class="w-100 btn btn-primary" type="submit" :disabled="processing">
                    {{ $t("Login") }}
                </button>

                <div v-if="res && !res.ok" class="alert alert-danger mt-3" role="alert">
                    {{ $t(res.msg) }}
                </div>

                <button class="btn btn-link mt-2" type="button" @click="showPasswordForm = false">
                    {{ $t("Log in with passkey") }}
                </button>
            </form>
        </div>
    </div>
</template>

<script>
import { login, loginWithPasskey, verifyTotp } from "../auth-client";
import HiddenInput from "./HiddenInput.vue";

export default {
    components: {
        HiddenInput,
    },
    data() {
        return {
            processing: false,
            username: "",
            password: "",
            token: "",
            res: null,
            tokenRequired: false,
            showPasswordForm: false,
        };
    },

    watch: {
        tokenRequired(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    this.$refs.otpInput?.focus();
                });
            }
        },
    },

    mounted() {
        document.title += " - Login";
    },

    unmounted() {
        document.title = document.title.replace(" - Login", "");
    },

    methods: {
        /**
         * Log in with a passkey of this device or a security key
         * @returns {Promise<void>}
         */
        async passkeyLogin() {
            this.processing = true;
            this.res = null;
            try {
                await loginWithPasskey();
            } catch (e) {
                this.res = { ok: false, msg: e.message };
            } finally {
                this.processing = false;
            }
        },

        /**
         * Submit the user details and attempt to log in
         * @returns {void}
         */
        async submit() {
            this.processing = true;

            try {
                if (this.tokenRequired) {
                    await verifyTotp(this.token);
                    return;
                }

                const result = await login(this.username, this.password, this.$root.remember);
                if (result === "twoFactorRequired") {
                    this.tokenRequired = true;
                }
            } catch (e) {
                this.res = { ok: false, msg: e.message };
            } finally {
                this.processing = false;
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.form-container {
    display: flex;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 40px;
}

.form-floating {
    > label {
        padding-left: 1.3rem;
    }

    > .form-control {
        padding-left: 1.3rem;
    }
}

.form {
    width: 100%;
    max-width: 330px;
    padding: 15px;
    margin: auto;
    text-align: center;
}
</style>
