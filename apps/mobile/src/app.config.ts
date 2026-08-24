export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/chat/index',
    'pages/search/index',
    'pages/myTest/index',
    'pages/addModel/index',
    'pages/user/index',
    'pages/model/index',
  ],
  window: {
    navigationBarTitleText: 'AI WorkSpace',

    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTextStyle: 'black',
  },
  subPackages: [{ root: 'pages/analysis', pages: ['index', 'list', 'detail'] }],
})
