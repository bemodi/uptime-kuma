<template>
    <div>
        <div class="add-btn">
            <button
                class="btn btn-primary me-2"
                type="button"
                data-testid="add-user-button"
                @click="$refs.userDialog.show()"
            >
                <font-awesome-icon icon="plus" />
                {{ $t("Add User") }}
            </button>
        </div>

        <p class="text-muted small">{{ $t("usersAllAdminsHint") }}</p>

        <div data-testid="user-list">
            <div
                v-for="user in users"
                :key="user.id"
                class="item"
                :class="user.active ? 'active' : 'inactive'"
                data-testid="user-item"
            >
                <div class="left-part">
                    <div class="circle"></div>
                    <div class="info">
                        <div class="title">
                            {{ user.username }}
                            <span v-if="user.isSelf" class="badge bg-primary ms-1">{{ $t("You") }}</span>
                        </div>
                        <div v-if="user.name && user.name !== user.username" class="status">{{ user.name }}</div>
                        <div class="status">{{ user.active ? $t("Active") : $t("Inactive") }}</div>
                        <div class="status" data-testid="user-passkey-count">
                            {{
                                user.passkeyCount > 0
                                    ? $t("passkeyCount", { count: user.passkeyCount })
                                    : $t("noPasskeyYet")
                            }}
                        </div>
                        <div class="date">{{ $t("createdAt", { date: formatDate(user.createdAt) }) }}</div>
                    </div>
                </div>

                <div v-if="!user.isSelf" class="buttons">
                    <div class="btn-group" role="group">
                        <button class="btn btn-normal" type="button" @click="confirm('reset', user)">
                            <font-awesome-icon icon="key" />
                            {{ $t("Reset Access") }}
                        </button>
                        <button
                            v-if="user.active"
                            class="btn btn-normal"
                            type="button"
                            data-testid="deactivate-user-button"
                            @click="confirm('deactivate', user)"
                        >
                            <font-awesome-icon icon="pause" />
                            {{ $t("Deactivate") }}
                        </button>
                        <button v-else class="btn btn-primary" type="button" @click="setActive(user, true)">
                            <font-awesome-icon icon="play" />
                            {{ $t("Activate") }}
                        </button>
                        <button class="btn btn-danger" type="button" @click="confirm('delete', user)">
                            <font-awesome-icon icon="trash" />
                            {{ $t("Delete") }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <Confirm ref="confirmReset" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="resetAccess">
            {{ $t("resetUserAccessMsg", { username: selectedUser?.username }) }}
        </Confirm>

        <Confirm
            ref="confirmDeactivate"
            :yes-text="$t('Yes')"
            :no-text="$t('No')"
            @yes="setActive(selectedUser, false)"
        >
            {{ $t("deactivateUserMsg", { username: selectedUser?.username }) }}
        </Confirm>

        <Confirm ref="confirmDelete" btn-style="btn-danger" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="deleteUser">
            {{ $t("deleteUserMsg", { username: selectedUser?.username }) }}
        </Confirm>

        <UserDialog ref="userDialog" @added="loadUsers" />
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import UserDialog from "../UserDialog.vue";

export default {
    components: {
        Confirm,
        UserDialog,
    },

    data() {
        return {
            users: [],
            selectedUser: null,
        };
    },

    mounted() {
        this.loadUsers();
    },

    methods: {
        /**
         * Load the user list from the server
         * @returns {void}
         */
        loadUsers() {
            this.$root.getSocket().emit("getUserList", (res) => {
                if (res.ok) {
                    this.users = res.users;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Show the confirmation dialog for an action
         * @param {string} action reset, deactivate or delete
         * @param {object} user Target user
         * @returns {void}
         */
        confirm(action, user) {
            this.selectedUser = user;
            const refs = {
                reset: "confirmReset",
                deactivate: "confirmDeactivate",
                delete: "confirmDelete",
            };
            this.$refs[refs[action]].show();
        },

        /**
         * Remove the user's passkeys, set a new generated password and show it once.
         * The user logs in with it and sets up a new passkey.
         * @returns {void}
         */
        resetAccess() {
            const user = this.selectedUser;
            this.$root.getSocket().emit("resetUserAccess", user.id, (res) => {
                if (res.ok) {
                    this.$refs.userDialog.showPassword(user.username, res.password);
                    this.loadUsers();
                } else {
                    this.$root.toastRes(res);
                }
            });
        },

        /**
         * Activate or deactivate a user
         * @param {object} user Target user
         * @param {boolean} active New state
         * @returns {void}
         */
        setActive(user, active) {
            this.$root.getSocket().emit("setUserActive", user.id, active, (res) => {
                this.$root.toastRes(res);
                this.loadUsers();
            });
        },

        /**
         * Delete the selected user
         * @returns {void}
         */
        deleteUser() {
            this.$root.getSocket().emit("deleteUser", this.selectedUser.id, (res) => {
                this.$root.toastRes(res);
                this.loadUsers();
            });
        },

        /**
         * Format a creation date for display
         * @param {string|number} value Date from the server
         * @returns {string} Formatted date
         */
        formatDate(value) {
            return value ? this.$root.datetime(value) : "";
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../../assets/vars.scss";

.add-btn {
    padding-top: 20px;
    padding-bottom: 10px;
}

.item {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    border-radius: 10px;
    transition: all ease-in-out 0.15s;
    justify-content: space-between;
    padding: 10px;
    min-height: 90px;
    margin-bottom: 5px;

    &:hover {
        background-color: $highlight-white;
    }

    &.active .circle {
        background-color: $primary;
    }

    &.inactive {
        .left-part {
            opacity: 0.5;
        }

        .circle {
            background-color: $danger;
        }
    }

    .left-part {
        display: flex;
        gap: 12px;
        align-items: center;

        .circle {
            flex-shrink: 0;
            width: 25px;
            height: 25px;
            border-radius: 50rem;
        }

        .info {
            .title {
                font-weight: bold;
                font-size: 20px;
            }

            .status {
                font-size: 14px;
            }
        }
    }

    .buttons {
        display: flex;
        gap: 8px;
        flex-direction: row-reverse;

        .btn {
            white-space: nowrap;
        }
    }
}

.date {
    margin-top: 5px;
    display: block;
    font-size: 14px;
    background-color: rgba(255, 255, 255, 0.5);
    border-radius: 20px;
    padding: 0 10px;
    width: fit-content;

    .dark & {
        color: white;
        background-color: rgba(255, 255, 255, 0.1);
    }
}

.dark .item:hover {
    background-color: $dark-bg2;
}
</style>
