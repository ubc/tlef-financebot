require 'json'
account = Account.default
login = 'financebot-demo-teacher'
pseudonym = account.pseudonyms.find_by(unique_id: login)
unless pseudonym
  teacher = account.users.create!(name: 'FinanceBot Demo Instructor')
  pseudonym = teacher.pseudonyms.create!(account: account, unique_id: login, password: login, password_confirmation: login)
end
teacher = pseudonym.user
teacher.update!(locale: 'en')
role = account.roles.find_by(name: 'FinanceBot Demo Teacher') || account.roles.create!(name: 'FinanceBot Demo Teacher', base_role_type: 'TeacherEnrollment')
RoleOverride.manage_role_override(account, role, 'read_sis', {enabled: true})
students = JSON.parse(File.read('/tmp/financebot-canvas-students.json'))
users = students.map do |s|
  name = s['name']; username = 'financebot-demo-' + s['login']
  p = account.pseudonyms.find_by(unique_id: username)
  unless p
    u = account.users.create!(name: name)
    p = u.pseudonyms.create!(account: account, unique_id: username, integration_id: s['puid'], password: username, password_confirmation: username)
  end
  p.update!(integration_id: s['puid'])
  p.user.update!(name: name)
  p.user
end
courses = ['101','102','201'].map do |section|
  code = 'FINANCEBOT-DEMO-' + section
  c = account.courses.find_by(course_code: code) || account.courses.create!(name: 'COMM 298 · Introduction to Finance · ' + section, course_code: code)
  c.offer! if c.workflow_state == 'created'
  c.enroll_user(teacher, 'TeacherEnrollment', enrollment_state: 'active', role: role)
  cohort = section == '101' ? users[0..11] : section == '102' ? users[10..19] : users[0..4]
  cohort.each { |u| c.enroll_user(u, 'StudentEnrollment', enrollment_state: 'active') }
  unless c.attachments.where(display_name: 'Finance foundations.txt').exists?
    f = Tempfile.new(['finance-foundations', '.txt']); f.write("Finance foundations\nPresent value discounts future cash flows.\nPV = FV / (1 + r)^n.\nDiversification reduces idiosyncratic risk.\n"); f.rewind
    a = c.attachments.build(display_name: 'Finance foundations.txt', filename: 'Finance foundations.txt', content_type: 'text/plain')
    a.uploaded_data = f; a.save!; f.close
  end
  {id: c.id, section: section, students: cohort.length}
end
puts 'FINANCEBOT_FIXTURES=' + {courses: courses, teacher: teacher.id, students: users.map(&:id)}.to_json
