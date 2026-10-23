<template>
    <div class="form-container">
        <div class="form">
            <form aria-label="Passkey Setup" class="pt-3" @submit.prevent="submit">
                <h1 class="h4 mb-3">{{ $t("setupPasskeyTitle") }}</h1>
                <p>{{ $t("setupPasskeyMsg", { username: $root.passkeyEnrollmentUser }) }}</p>

                <div class="form-floating mb-3">
                    <input
                        id="passkeyName"
                        v-model="name"
                        type="text"
                        class="form-control"
                        :placeholder="$t('passkeyNamePlaceholder')"
                        maxlength="100"
                        autocomplete="off"
                    />
                    <label for="passkeyName">{{ $t("passkeyNamePlaceholder") }}</label>
                </div>

                <button class="w-100 btn btn-primary" type="submit" :disabled="processing">
                    <font-awesome-icon icon="key" class="me-1" />
                    {{ $t("Create passkey") }}
                </button>

                <div v-if="error" class="alert alert-danger mt-3" role="alert">
                    {{ $t(error) }}
                </div>

                <button class="btn btn-link mt-3" type="button" @click="$root.logout">
                    {{ $t("Logout") }}
                </button>
            </form>
        </div>
    </div>
</template>

<script>
import { addPasskey } from "../auth-client";
import { reconnectSocket } from "../mixins/socket";

export default {
    data() {
        return {
            processing: false,
            name: "",
            error: null,
        };
    },

    methods: {
        /**
         * Create the first passkey, then reconnect so the server sees it and logs the user in
         * @returns {Promise<void>}
         */
        async submit() {
            this.processing = true;
            this.error = null;
            try {
                await addPasskey(this.name.trim());
                reconnectSocket();
            } catch (e) {
                this.error = e.message;
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
    max-width: 380px;
    padding: 15px;
    margin: auto;
    text-align: center;
}
</style>
