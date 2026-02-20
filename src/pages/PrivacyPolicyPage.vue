<script setup>
import { t } from '../lib/i18n'
</script>

<template>
  <div class="privacy-page">
    <section class="privacy-card">
      <h1>{{ t('Политика конфиденциальности') }}</h1>
      <p class="lead">
        {{ t('Эта политика описывает, какие персональные данные обрабатываются в PhotoLog и для каких целей.') }}
      </p>

      <h2>{{ t('Какие данные мы обрабатываем') }}</h2>
      <ul>
        <li>{{ t('Имя и email, указанные при регистрации.') }}</li>
        <li>{{ t('Загружаемые фото, названия серий, описания и теги.') }}</li>
        <li>{{ t('Технические данные запросов, необходимые для безопасности и работы сервиса.') }}</li>
      </ul>

      <h2>{{ t('Цели обработки') }}</h2>
      <ul>
        <li>{{ t('Создание и обслуживание аккаунта пользователя.') }}</li>
        <li>{{ t('Хранение, отображение и поиск ваших фотосерий.') }}</li>
        <li>{{ t('Отправка сервисных писем (например, восстановление пароля).') }}</li>
      </ul>

      <h2>{{ t('Хранение и защита данных') }}</h2>
      <p>
        {{ t('Мы применяем организационные и технические меры для защиты персональных данных от несанкционированного доступа, изменения или удаления.') }}
      </p>

      <h2>{{ t('Права пользователя') }}</h2>
      <p>
        {{ t('Вы можете запросить обновление или удаление данных аккаунта, а также отозвать согласие на обработку персональных данных в предусмотренных законом случаях.') }}
      </p>

      <h2>{{ t('Контакты') }}</h2>
      <p>
        {{ t('По вопросам обработки персональных данных используйте контактные каналы, указанные на сайте PhotoLog.') }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.privacy-page {
  min-height: calc(100vh - 58px);
  background:
    radial-gradient(700px 220px at 15% 0%, rgba(183, 201, 190, 0.35), transparent 65%),
    radial-gradient(860px 260px at 100% 15%, rgba(218, 206, 188, 0.28), transparent 70%),
    var(--bg);
  display: grid;
  place-items: start center;
  padding: 24px;
}

.privacy-card {
  width: min(840px, 100%);
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 20px 40px rgba(79, 86, 80, 0.1);
  padding: 22px;
  color: var(--text);
}

.privacy-card h1 {
  margin: 0 0 8px;
  font-size: 34px;
  letter-spacing: -0.03em;
}

.lead {
  margin: 0 0 16px;
  color: #4b574f;
}

.privacy-card h2 {
  margin: 16px 0 8px;
  font-size: 22px;
}

.privacy-card p {
  margin: 0;
  color: #3f4a43;
}

.privacy-card ul {
  margin: 0;
  padding-left: 20px;
  color: #3f4a43;
}
</style>
