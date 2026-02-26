<script setup>
const props = defineProps({
  page: {
    type: Number,
    required: true,
  },
  lastPage: {
    type: Number,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  pageLabel: {
    type: String,
    required: true,
  },
  prevLabel: {
    type: String,
    required: true,
  },
  nextLabel: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['change'])

function goTo(targetPage) {
  if (props.disabled) return
  if (targetPage < 1 || targetPage > props.lastPage) return
  if (targetPage === props.page) return
  emit('change', targetPage)
}
</script>

<template>
  <nav v-if="lastPage > 1" class="pagination" aria-label="Pagination">
    <button type="button" class="pagination-btn" :disabled="disabled || page <= 1" @click="goTo(page - 1)">
      {{ prevLabel }}
    </button>
    <span class="pagination-meta">{{ pageLabel }} {{ page }} / {{ lastPage }}</span>
    <button type="button" class="pagination-btn" :disabled="disabled || page >= lastPage" @click="goTo(page + 1)">
      {{ nextLabel }}
    </button>
  </nav>
</template>

<style scoped>
.pagination {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.pagination-btn {
  border: 1px solid #d2dacf;
  border-radius: 10px;
  background: #edf3ec;
  color: #2f4637;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.1;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.pagination-btn:hover:not(:disabled) {
  background: #ddebe0;
  border-color: #b8ccb8;
}

.pagination-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pagination-meta {
  font-size: 14px;
  color: #425a49;
  font-weight: 600;
  white-space: nowrap;
}
</style>
