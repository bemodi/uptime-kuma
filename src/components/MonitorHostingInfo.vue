<template>
    <!-- Fork: where the site is hosted and who issued its certificate -->
    <div v-if="hosting || issuer" class="hosting-info">
        <span v-if="hosting" class="info-chip" :title="hostingTitle" data-testid="hosting-chip">
            <font-awesome-icon icon="server" />
            <span class="label">{{ $t("hostingLabel") }}</span>
            <strong>{{ hostingName }}</strong>
            <span v-if="hosting.cdn" class="tag">CDN</span>
        </span>
        <button
            v-if="issuer"
            type="button"
            class="info-chip"
            :title="issuerTitle"
            data-testid="issuer-chip"
            @click="$emit('toggle-cert')"
        >
            <font-awesome-icon icon="certificate" />
            <span class="label">{{ $t("certIssuerLabel") }}</span>
            <strong>{{ issuer }}</strong>
        </button>
    </div>
</template>

<script>
export default {
    props: {
        /** ID of the monitor */
        monitorId: {
            type: Number,
            required: true,
        },
    },
    emits: ["toggle-cert"],
    computed: {
        hosting() {
            return this.$root.hostingInfoList[this.monitorId] || null;
        },

        tlsInfo() {
            return this.$root.tlsInfoList[this.monitorId] || null;
        },

        hostingName() {
            const h = this.hosting;
            if (h.private) {
                return this.$t("hostingPrivate");
            }
            const operator = h.provider || (h.asn ? `AS${h.asn}` : null);
            if (h.cdn) {
                // A different network below the CDN, e.g. Vercel on AWS
                return operator && operator !== h.cdn ? `${h.cdn} (${operator})` : h.cdn;
            }
            return operator || this.$t("hostingUnknown");
        },

        hostingTitle() {
            const h = this.hosting;
            const lines = [`IP ${h.ip}`];
            if (h.asn) {
                lines.push(`AS${h.asn} ${h.asName || ""}`.trim());
            }
            if (h.cdn) {
                lines.push(this.$t("hostingCdnHint"));
            }
            return lines.join("\n");
        },

        issuer() {
            const issuer = this.tlsInfo?.certInfo?.issuer;
            if (!issuer) {
                return null;
            }
            if (issuer.O && issuer.CN && issuer.O !== issuer.CN) {
                return `${issuer.O} · ${issuer.CN}`;
            }
            return issuer.O || issuer.CN || null;
        },

        issuerTitle() {
            const lines = [this.$t("certIssuerToggle")];
            if (this.hosting?.cdn) {
                lines.push(this.$t("certIssuerCdnHint"));
            }
            return lines.join("\n");
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.hosting-info {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: -8px 0 20px;
}

.info-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 12px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 999px;
    background-color: rgba(255, 255, 255, 0.6);
    color: inherit;
    font-size: 14px;

    .label {
        color: $secondary-text;
    }

    .tag {
        padding: 1px 7px;
        border-radius: 999px;
        background-color: rgba($primary, 0.18);
        font-size: 11px;
        font-weight: 700;
    }

    .dark & {
        border-color: $dark-border-color;
        background-color: $dark-bg2;
        color: $dark-font-color;
    }
}

button.info-chip {
    cursor: pointer;
}
</style>
