import App from '@/App.vue'
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: App,
      meta: { title: 'Cue Aimer' }
    },
  ],
})

router.beforeEach((to, from, next) => {
  // 从路由的元信息中获取标题
  document.title = to.meta.title as string || 'Cue Aimer';
  next();
});

export default router
