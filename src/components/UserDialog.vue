<template>
    <div>
        <form @submit.prevent="submit">
            <div ref="addModal" class="modal fade" tabindex="-1" data-bs-backdrop="static">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">{{ $t("Add User") }}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" :aria-label="$t('Close')" />
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label for="new-user-username" class="form-label">{{ $t("Username") }}</label>
                                <input
                                    id="new-user-username"
                                    v-model="user.username"
                                    type="text"
                                    class="form-control"
                                    autocomplete="off"
                                    pattern="[A-Za-z0-9_.]{3,30}"
                                    required
                                />
                                <div class="form-text">{{ $t("usernameRules") }}</div>
                            </div>
                            <div class="mb-3">
                                <label for="new-user-name" class="form-label">{{ $t("Display Name") }}</label>
                                <input
                                    id="new-user-name"
                                    v-model="user.name"
                                    type="text"
                                    class="form-control"
                                    autocomplete="off"
                                />
                            </div>
                            <div class="form-text">{{ $t("addUserPasswordHint") }}</div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-primary" type="submit" :disabled="processing">
                                {{ $t("Add User") }}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </form>

        <div ref="passwordModal" class="modal fade" tabindex="-1" data-bs-backdrop="static">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">{{ $t("passwordFor", { username: shownUsername }) }}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" :aria-label="$t('Close')" />
                    </div>
                    <div class="modal-body">
                        <p>{{ $t("initialPasswordMsg") }}</p>
                        <CopyableInput v-model="shownPassword" disabled="disabled" data-testid="initial-password" />
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" data-bs-dismiss="modal">
                            {{ $t("Continue") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { Modal } from "bootstrap";
import CopyableInput from "./CopyableInput.vue";

export default {
    components: {
        CopyableInput,
    },

    emits: ["added"],

    data() {
        return {
            addModal: null,
            passwordModal: null,
            processing: false,
            user: {
                username: "",
                name: "",
            },
            shownUsername: "",
            shownPassword: "",
        };
    },

    mounted() {
        this.addModal = new Modal(this.$refs.addModal);
        this.passwordModal = new Modal(this.$refs.passwordModal);
        this.$refs.passwordModal.addEventListener("hidden.bs.modal", () => {
            this.shownPassword = "";
        });
    },

    methods: {
        /**
         * Show the form to add a user
         * @returns {void}
         */
        show() {
            this.user = {
                username: "",
                name: "",
            };
            this.addModal.show();
        },

        /**
         * Show a generated password once
         * @param {string} username User the password belongs to
         * @param {string} password Generated password
         * @returns {void}
         */
        showPassword(username, password) {
            this.shownUsername = username;
            this.shownPassword = password;
            this.passwordModal.show();
        },

        /**
         * Create the user on the server
         * @returns {void}
         */
        submit() {
            this.processing = true;
            this.$root.getSocket().emit("addUser", this.user, (res) => {
                this.processing = false;
                if (res.ok) {
                    this.addModal.hide();
                    this.showPassword(this.user.username, res.password);
                    this.$emit("added");
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
    },
};
</script>
