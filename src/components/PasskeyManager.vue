<template>
    <div>
        <h5 class="my-4 settings-subheading">{{ $t("Passkeys") }}</h5>
        <p class="small text-muted">{{ $t("passkeysHint", { min: minPasskeys, max: maxPasskeys }) }}</p>

        <ul class="list-group mb-3" data-testid="passkey-list">
            <li
                v-for="passkey in passkeys"
                :key="passkey.id"
                class="list-group-item d-flex align-items-center justify-content-between gap-2"
                data-testid="passkey-item"
            >
                <div>
                    <div class="fw-bold">
                        <font-awesome-icon icon="key" class="me-1" />
                        {{ passkey.name || $t("Passkey") }}
                    </div>
                    <div class="small text-muted">
                        {{ $t("createdAt", { date: $root.datetime(passkey.createdAt) }) }}
                    </div>
                </div>
                <div class="btn-group">
                    <button class="btn btn-sm btn-normal" type="button" @click="rename(passkey)">
                        {{ $t("Rename") }}
                    </button>
                    <button
                        class="btn btn-sm btn-danger"
                        type="button"
                        :disabled="passkeys.length <= minPasskeys"
                        :title="passkeys.length <= minPasskeys ? $t('passkeyMinimumMsg') : ''"
                        @click="confirmDelete(passkey)"
                    >
                        {{ $t("Delete") }}
                    </button>
                </div>
            </li>
        </ul>

        <form class="d-flex gap-2 mb-3" @submit.prevent="add">
            <input
                v-model="newName"
                type="text"
                class="form-control"
                maxlength="100"
                :placeholder="$t('passkeyNamePlaceholder')"
                :disabled="passkeys.length >= maxPasskeys"
            />
            <button
                class="btn btn-primary text-nowrap"
                type="submit"
                :disabled="processing || passkeys.length >= maxPasskeys"
            >
                <font-awesome-icon icon="plus" />
                {{ $t("Add Passkey") }}
            </button>
        </form>

        <Confirm ref="confirmDelete" btn-style="btn-danger" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="remove">
            {{ $t("deletePasskeyMsg", { name: selected?.name || $t("Passkey") }) }}
        </Confirm>
    </div>
</template>

<script>
import Confirm from "./Confirm.vue";
import { addPasskey, deletePasskey, listPasskeys, renamePasskey } from "../auth-client";

export default {
    components: {
        Confirm,
    },

    data() {
        return {
            passkeys: [],
            newName: "",
            selected: null,
            processing: false,
            // Same limits as server/passkey-policy.ts, which enforces them
            minPasskeys: 1,
            maxPasskeys: 3,
        };
    },

    mounted() {
        this.load();
    },

    methods: {
        /**
         * Load the passkeys of the logged-in user
         * @returns {Promise<void>}
         */
        async load() {
            try {
                this.passkeys = await listPasskeys();
            } catch (e) {
                this.$root.toastError(e.message);
            }
        },

        /**
         * Create a new passkey with the browser
         * @returns {Promise<void>}
         */
        async add() {
            this.processing = true;
            try {
                await addPasskey(this.newName.trim());
                this.newName = "";
                this.$root.toastSuccess("passkeyCreated");
                await this.load();
            } catch (e) {
                this.$root.toastError(e.message);
            } finally {
                this.processing = false;
            }
        },

        /**
         * Ask for a new label
         * @param {object} passkey Passkey to rename
         * @returns {Promise<void>}
         */
        async rename(passkey) {
            const name = window.prompt(this.$t("passkeyNamePlaceholder"), passkey.name || "");
            if (name === null || !name.trim()) {
                return;
            }
            try {
                await renamePasskey(passkey.id, name.trim());
                await this.load();
            } catch (e) {
                this.$root.toastError(e.message);
            }
        },

        /**
         * Show the delete confirmation
         * @param {object} passkey Passkey to delete
         * @returns {void}
         */
        confirmDelete(passkey) {
            this.selected = passkey;
            this.$refs.confirmDelete.show();
        },

        /**
         * Delete the selected passkey
         * @returns {Promise<void>}
         */
        async remove() {
            try {
                await deletePasskey(this.selected.id);
                this.$root.toastSuccess("passkeyDeleted");
                await this.load();
            } catch (e) {
                this.$root.toastError(e.message);
            }
        },
    },
};
</script>
